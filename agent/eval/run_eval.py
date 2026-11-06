"""Evaluate the MediAssist agent against hand-written test consultations.

    python -m eval.run_eval                         # all cases, model from .env
    python -m eval.run_eval --model gpt-4.1         # try another model
    python -m eval.run_eval --cases 03 09           # only some cases (by number prefix)

Each case = eval/cases/NN_name.txt (transcript) + NN_name.expected.json (the correct answers).
Results: a table in the terminal + eval/results/<timestamp>_<model>.json with every detail.

What is measured (per case and overall)
  symptoms      recall (expected found) / precision (found that were expected) / denied-or-uncertain
                symptoms wrongly listed as present
  prescription  recall / precision on medicine names, accuracy of strength/dose/frequency/duration/status,
                FORBIDDEN = a medicine that was declined/stopped/hypothetical/discussed but ended up prescribed,
                INVENTED  = a field filled where the expected answer is null (nothing was said)
  history       recall of expected past medicines/conditions
  safety        verification warnings (things the grounding check removed or cleared), failed nodes,
                and number of reviewed suggestions
  latency       seconds per consultation
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
CASES_DIR = EVAL_DIR / "cases"
RESULTS_DIR = EVAL_DIR / "results"
FIELDS = ("strength", "dose", "frequency", "duration", "status")


# --------------------------------------------------------------------------- matching helpers
def _norm(text) -> str:
    from mediassist_agent.grounding import normalise
    return normalise(str(text or ""))


def symptom_matches(synonyms: list[str], predicted: list[dict]) -> dict | None:
    """A predicted symptom matches if any synonym appears in its standardized name or mention."""
    for p in predicted:
        cand = [_norm(p.get("standardized")), _norm(p.get("mention"))]
        for syn in synonyms:
            s = _norm(syn)
            for c in cand:
                if c and (s in c or c in s or difflib.SequenceMatcher(None, s, c).ratio() >= 0.8):
                    return p
    return None


def medicine_matches(expected: dict, predicted: list[dict]) -> dict | None:
    from mediassist_agent.text import norm_generic, norm_name
    names = {norm_name(expected["name"])} | {norm_name(a) for a in expected.get("aliases", [])}
    names |= {norm_generic(a) for a in expected.get("aliases", [])}
    names.discard("")
    for p in predicted:
        keys = {norm_name(p.get("name")), norm_generic(p.get("generic_name"))}
        keys |= {norm_name(w) for w in (p.get("name") or "").split()}
        if names & {k for k in keys if k}:
            return p
    return None


def field_correct(expected, predicted) -> bool:
    """Numbers must agree ('1 tablet' == 'one tablet', 'twice a day' == '2 times a day');
    without numbers, the expected words must appear in the prediction."""
    from mediassist_agent.grounding import numbers
    if expected is None:
        return predicted in (None, "")
    if predicted in (None, ""):
        return False
    en, pn = numbers(expected), numbers(predicted)
    if en:
        return en <= pn
    e, p = _norm(expected), _norm(predicted)
    return e in p or p in e or difflib.SequenceMatcher(None, e, p).ratio() >= 0.8


def history_matches(expected: dict, predicted: list[dict]) -> bool:
    for p in predicted:
        for key, pkey in (("medicine", "medicine_name"), ("condition", "condition")):
            e = expected.get(key)
            if e and p.get(pkey):
                a, b = _norm(e), _norm(p.get(pkey))
                if a in b or b in a or difflib.SequenceMatcher(None, a, b).ratio() >= 0.75:
                    return True
    return False


# --------------------------------------------------------------------------- scoring
def score_case(expected: dict, state: dict) -> dict:
    symptoms = state.get("symptoms", [])
    meds = [m for m in state.get("reconciled_medicines", []) if m.get("tag") == "doctor_prescribed"]
    if not meds:  # Node 4 failed -> fall back to Node 2's raw list
        meds = state.get("prescribed_medicines", [])
    history = state.get("medical_history", [])
    errors = state.get("errors", [])
    r: dict = {"details": []}

    # symptoms
    exp_sym = expected.get("symptoms_present", [])
    found = [syn for syn in exp_sym if symptom_matches(syn, symptoms)]
    matched_pred = {id(symptom_matches(syn, symptoms)) for syn in exp_sym if symptom_matches(syn, symptoms)}
    wrongly_present = [syn[0] for syn in expected.get("symptoms_absent", []) if symptom_matches(syn, symptoms)]
    extra = [s.get("standardized") for s in symptoms if id(s) not in matched_pred]
    r["symptom_recall"] = (len(found), len(exp_sym))
    r["symptom_precision"] = (len(symptoms) - len(extra), len(symptoms))
    r["symptoms_wrongly_present"] = wrongly_present
    r["symptoms_missed"] = [syn[0] for syn in exp_sym if syn not in found]
    r["symptoms_extra"] = extra

    # prescription
    exp_meds = expected.get("prescribed", [])
    hits, field_ok, field_total, invented = [], 0, 0, []
    used = set()
    for e in exp_meds:
        p = medicine_matches(e, meds)
        if not p:
            r["details"].append(f"MISSED prescription: {e['name']}")
            continue
        hits.append(e["name"])
        used.add(id(p))
        for f in FIELDS:
            if f not in e:
                continue  # not checked for this medicine
            pv = p.get("prescription_status") if f == "status" else p.get(f)
            field_total += 1
            if field_correct(e[f], pv):
                field_ok += 1
            else:
                if e[f] is None:
                    invented.append(f"{e['name']}.{f}={pv!r}")
                r["details"].append(f"{e['name']}.{f}: expected {e[f]!r}, got {pv!r}")
    unexpected = [m.get("name") for m in meds if id(m) not in used]
    forbidden = [n for n in expected.get("not_prescribed", []) if medicine_matches({"name": n}, meds)]
    r["rx_recall"] = (len(hits), len(exp_meds))
    r["rx_precision"] = (len(meds) - len(unexpected), len(meds))
    r["rx_fields"] = (field_ok, field_total)
    r["rx_unexpected"] = unexpected
    r["rx_forbidden"] = forbidden
    r["rx_invented_fields"] = invented

    # history
    exp_hist = expected.get("history", [])
    r["history_recall"] = (sum(history_matches(h, history) for h in exp_hist), len(exp_hist))

    # safety / robustness
    r["verification_warnings"] = [e["error"] for e in errors if e.get("kind") == "verification"]
    r["failed_nodes"] = [e["node"] for e in errors if e.get("kind") != "verification"]
    r["suggestions"] = len([m for m in state.get("reconciled_medicines", []) if m.get("tag") == "rag_suggested"])
    return r


def _pct(pair) -> str:
    a, b = pair
    return "  -  " if b == 0 else f"{100 * a / b:4.0f}%"


def _sum(results, key):
    return (sum(r[key][0] for r in results), sum(r[key][1] for r in results))


# --------------------------------------------------------------------------- main
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Evaluate the MediAssist agent")
    ap.add_argument("--model", help="Override AGENT_LLM_MODEL for this run")
    ap.add_argument("--cases", nargs="*", help="Only cases whose file name starts with these prefixes")
    a = ap.parse_args(argv)
    if a.model:
        os.environ["AGENT_LLM_MODEL"] = a.model  # must be set before the agent is imported

    import logging
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    from mediassist_agent.config import settings
    from mediassist_agent.graph import get_graph

    cases = sorted(CASES_DIR.glob("*.txt"))
    if a.cases:
        cases = [c for c in cases if any(c.name.startswith(p) for p in a.cases)]
    if not cases:
        print("no cases found")
        return 1

    print(f"model={settings.llm_model}  temperature={settings.llm_temperature}  cases={len(cases)}\n")
    results = []
    for case in cases:
        expected = json.loads(case.with_suffix(".expected.json").read_text(encoding="utf-8"))
        t0 = time.perf_counter()
        try:
            state = get_graph().invoke({"consultation_id": case.stem, "raw_transcript":
                                        case.read_text(encoding="utf-8"), "errors": []})
            error = None
        except Exception as exc:  # the whole graph crashed - count it, keep going
            state, error = {}, f"{type(exc).__name__}: {exc}"
        r = score_case(expected, state)
        r.update(case=case.stem, seconds=round(time.perf_counter() - t0, 1), crash=error,
                 output=state.get("soap_response"))
        results.append(r)
        flags = []
        if r["rx_forbidden"]:
            flags.append(f"FORBIDDEN {r['rx_forbidden']}")
        if r["rx_invented_fields"]:
            flags.append(f"INVENTED {r['rx_invented_fields']}")
        if r["symptoms_wrongly_present"]:
            flags.append(f"DENIED-AS-PRESENT {r['symptoms_wrongly_present']}")
        if error or r["failed_nodes"]:
            flags.append(f"FAILED {error or r['failed_nodes']}")
        print(f"{case.stem:28s} sym {_pct(r['symptom_recall'])}/{_pct(r['symptom_precision'])}  "
              f"rx {_pct(r['rx_recall'])}/{_pct(r['rx_precision'])}  fields {_pct(r['rx_fields'])}  "
              f"hist {_pct(r['history_recall'])}  {r['seconds']:5.1f}s  {'  '.join(flags)}")
        for d in r["details"]:
            print(f"{'':30s}- {d}")

    n = len(results)
    summary = {
        "model": settings.llm_model,
        "temperature": settings.llm_temperature,
        "cases": n,
        "symptom_recall": _pct(_sum(results, "symptom_recall")).strip(),
        "symptom_precision": _pct(_sum(results, "symptom_precision")).strip(),
        "denied_or_uncertain_listed_as_present": sum(len(r["symptoms_wrongly_present"]) for r in results),
        "prescription_recall": _pct(_sum(results, "rx_recall")).strip(),
        "prescription_precision": _pct(_sum(results, "rx_precision")).strip(),
        "prescription_field_accuracy": _pct(_sum(results, "rx_fields")).strip(),
        "forbidden_medicines_prescribed": sum(len(r["rx_forbidden"]) for r in results),
        "invented_fields": sum(len(r["rx_invented_fields"]) for r in results),
        "history_recall": _pct(_sum(results, "history_recall")).strip(),
        "verification_warnings": sum(len(r["verification_warnings"]) for r in results),
        "failed_nodes_or_crashes": sum(len(r["failed_nodes"]) + bool(r["crash"]) for r in results),
        "avg_seconds": round(sum(r["seconds"] for r in results) / n, 1),
    }
    print("\n" + "=" * 70)
    for k, v in summary.items():
        print(f"{k:42s} {v}")
    print("=" * 70)
    print("Safety targets: forbidden_medicines_prescribed = 0, invented_fields = 0, "
          "denied_or_uncertain_listed_as_present = 0")

    RESULTS_DIR.mkdir(exist_ok=True)
    out = RESULTS_DIR / f"{datetime.now():%Y%m%d_%H%M%S}_{settings.llm_model.replace('/', '_')}.json"
    out.write_text(json.dumps({"summary": summary, "cases": results}, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nfull results: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
