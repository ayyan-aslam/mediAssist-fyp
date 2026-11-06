"""Offline tests - no OpenAI key or database needed (the LLM and RAG are faked).

Run from the agent/ folder:  python -m pytest -q
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mediassist_agent import cleaning
from mediassist_agent.fallback import resilient_node
from mediassist_agent.nodes import node1_symptoms_rag as n1, node2_prescription as n2, node3_history as n3, soap
from mediassist_agent.medicine_info import merge_info
from mediassist_agent.nodes.node4_compare import reconcile, same_medicine
from mediassist_agent.text import norm_generic, norm_name
from mediassist_agent.schemas import (
    ExtractedSymptom, HistoryExtraction, HistoryItem, PrescribedMedicine, PrescriptionExtraction,
    RagMedicine, SoapNarrative, SuggestionReview, SymptomExtraction,
)
from mediassist_agent.sources.inbox import TranscriptInbox

SAMPLE = Path(__file__).resolve().parent.parent / "samples" / "sample_consultation_01.txt"


# ---------------------------------------------------------------- cleaning
def test_cleaning_tags_timestamps_fillers_and_continuations():
    raw = "[00:01] DR: Hello, um how are you?\n00:00:05 - pt: uh I have   fever\nsince two days\nP: and cough"
    text, turns = cleaning.clean_transcript(raw)
    assert turns == [
        {"speaker": "Doctor", "text": "Hello, how are you?"},
        {"speaker": "Patient", "text": "I have fever since two days and cough"},
    ]
    assert text.startswith("Doctor: Hello")


def test_sample_transcript_parses():
    _, turns = cleaning.clean_transcript(SAMPLE.read_text(encoding="utf-8"))
    assert {t["speaker"] for t in turns} == {"Doctor", "Patient"}
    assert any("Glucophage 500 twice a day" in t["text"] for t in turns)  # continuation line joined


# ---------------------------------------------------------------- fallback
def test_fallback_retries_then_degrades_without_fabricating():
    calls = []

    @resilient_node("x", {"items": []}, max_retries=2)
    def flaky(state, attempt):
        calls.append(attempt)
        raise ValueError("bad json")

    out = flaky({})
    assert calls == [0, 1, 2]
    assert out["items"] == [] and out["errors"][0]["node"] == "x" and out["errors"][0]["attempts"] == 3


def test_fallback_recovers_on_retry():
    @resilient_node("y", {"items": []}, max_retries=2)
    def once_bad(state, attempt):
        if attempt == 0:
            raise ValueError("first try fails")
        return {"items": [1]}

    assert once_bad({}) == {"items": [1]}


# ---------------------------------------------------------------- node 4
def test_norm_and_identity():
    assert norm_name("Tab. Panadol 500mg") == "panadol"
    assert norm_generic("Artemether (15mg); Lumefantrine (90mg)") == "artemether + lumefantrine"
    assert norm_generic("Lumefantrine , Artemether") == "artemether + lumefantrine"
    assert norm_generic("Paracetamol (500mg)") == norm_name("Paracetamol 500 mg") == "paracetamol"
    assert same_medicine("Panadol", "paracetamol", "Calpol", "Paracetamol")       # generic match
    assert same_medicine("Augmentin 625 mg", None, "augmentin", "co-amoxiclav")   # name match
    assert not same_medicine("Panadol", None, "Brufen", "ibuprofen")


def test_reconcile_doctor_wins_and_tags():
    doctor = [
        PrescribedMedicine(name="Paracetamol 500 mg", dose="1 tablet", frequency="TDS", duration="5 days"),
        PrescribedMedicine(name="Omeprazole"),
    ]
    rag = [
        RagMedicine(record_id="ds:1", name="Panadol", generic_name="Paracetamol", linked_symptoms=["fever"]),
        RagMedicine(record_id="ds:2", name="Brufen", generic_name="Ibuprofen", linked_symptoms=["headache"]),
        RagMedicine(record_id="ds:3", name="Advil", generic_name="ibuprofen", linked_symptoms=["fever"]),
    ]
    out = {m.name: m for m in reconcile(doctor, rag)}
    para = out["Paracetamol 500 mg"]
    assert para.tag == "doctor_prescribed" and para.match_status == "matched"
    assert para.dose == "1 tablet" and para.frequency == "TDS"          # doctor's fields unchanged
    assert para.linked_symptoms == ["fever"] and para.record_id == "ds:1"
    assert out["Omeprazole"].match_status == "doctor_only"
    assert "Panadol" not in out                                          # duplicate of a doctor med removed
    sugg = [m for m in out.values() if m.tag == "rag_suggested"]
    assert len(sugg) == 1 and sugg[0].name == "Brufen"                   # Advil deduped into Brufen
    assert sugg[0].linked_symptoms == ["headache", "fever"]


# ---------------------------------------------------------------- inbox
def test_inbox_claim_and_finish(tmp_path):
    inbox = TranscriptInbox(tmp_path / "inbox", tmp_path / "outbox")
    (tmp_path / "inbox/pending/c1.txt").write_text("Doctor: hi", encoding="utf-8")
    (tmp_path / "inbox/pending/c1.json").write_text(json.dumps({"patient_id": "p1"}), encoding="utf-8")
    (tmp_path / "inbox/pending/c2.txt.part").write_text("still copying", encoding="utf-8")

    job = inbox.claim_next()
    assert job.consultation_id == "c1" and job.patient_id == "p1"
    assert job.transcript_path.parent.name == "processing"
    assert inbox.claim_next() is None                                    # .part file ignored
    inbox.write_result(job, {"ok": True})
    inbox.finish(job, ok=True)
    assert (tmp_path / "inbox/done/c1.txt").exists()
    assert json.loads((tmp_path / "outbox/c1.json").read_text())["ok"] is True


# ---------------------------------------------------------------- whole graph (fake LLM + fake RAG)
class FakeStore:
    PRODUCTS = {
        "dawaai:panadol": {"id": "dawaai:panadol", "source": "dawaai", "name": "Panadol 500mg",
                           "generic_name": "Paracetamol (500mg)", "generic_norm": "paracetamol", "url": "u1",
                           "info": {"side_effects": "Rash", "warnings": "Liver disease"}},
        "dvago:panadol": {"id": "dvago:panadol", "source": "dvago", "name": "Panadol Tablets",
                          "generic_name": "Paracetamol", "generic_norm": "paracetamol", "url": "u2",
                          "info": {"dosage_reference": "500-1000 mg every 6 h", "warnings": "Do not exceed 4 g/day"}},
        "dvago:brufen": {"id": "dvago:brufen", "source": "dvago", "name": "Brufen 400mg",
                         "generic_name": "Ibuprofen", "generic_norm": "ibuprofen", "url": "u3",
                         "info": {"side_effects": "stomach upset", "dosage_reference": "200-400 mg"}},
    }
    LABELS = {"fever": ["dawaai:panadol"], "headache": ["dvago:brufen"]}

    def search(self, symptom, embedding):
        if symptom not in self.LABELS:
            return None
        meds = [{"id": i, "source_dataset": self.PRODUCTS[i]["source"], "medicine_name": self.PRODUCTS[i]["name"],
                 "generic_name": self.PRODUCTS[i]["generic_name"]} for i in self.LABELS[symptom]]
        return {"match_type": "exact", "dataset_symptom": symptom.title(), "similarity": 1.0, "medicines": meds}

    def lookup_products(self, meds):
        out = []
        for m in meds:
            hits = {}
            keys = {norm_name(m.get("name")), norm_generic(m.get("generic_name")) or norm_generic(m.get("name"))}
            for p in self.PRODUCTS.values():
                if p["id"] == m.get("record_id") or p["generic_norm"] in keys or norm_name(p["name"]) in keys:
                    hits.setdefault(p["source"], p)
            out.append(hits)
        return out


def fake_extract(schema, prompt, transcript):
    if schema is SymptomExtraction:
        return SymptomExtraction(symptoms=[
            ExtractedSymptom(mention="fever", status="present", standardized="fever"),
            ExtractedSymptom(mention="bad headache", status="present", standardized="headache"),
            ExtractedSymptom(mention="dry cough", status="present", standardized="dry cough"),
            ExtractedSymptom(mention="vomiting", status="denied", standardized="vomiting"),
        ])
    if schema is PrescriptionExtraction:
        return PrescriptionExtraction(medicines=[PrescribedMedicine(
            name="Paracetamol 500 mg", dose="1 tablet", frequency="three times a day",
            duration="5 days", instructions="after meals")])
    if schema is HistoryExtraction:
        return HistoryExtraction(items=[HistoryItem(condition="diabetes", medicine_name="Glucophage 500",
                                                    duration="5 years", frequency="twice a day",
                                                    status="currently_taking")])
    if schema is SuggestionReview:
        import re as _re
        ids = _re.findall(r'"candidate_id": "(c\d+)"', transcript)
        return SuggestionReview(decisions=[{"candidate_id": i, "keep": True, "reason": "ok"} for i in ids])
    if schema is SoapNarrative:
        return SoapNarrative(subjective="Fever 3 days, headache, dry cough.", objective="Temp 101F.",
                             assessment="Viral infection.", plan_notes="Fluids, rest, CBC if no improvement.")
    raise AssertionError(schema)


def test_full_graph(monkeypatch):
    pytest.importorskip("langgraph")
    from mediassist_agent.nodes import node4_compare as n4
    from mediassist_agent.rag import store as store_mod

    for mod in (n1, n2, n3, soap):
        monkeypatch.setattr(mod, "extract", fake_extract)
    monkeypatch.setattr(n1, "embed", lambda texts: [[0.0] * 3 for _ in texts])
    monkeypatch.setattr(n1, "SymptomMedicineStore", FakeStore)
    monkeypatch.setattr(store_mod, "SymptomMedicineStore", FakeStore)
    from mediassist_agent.graph import build_graph

    final = build_graph().invoke({"consultation_id": "c1", "raw_transcript": SAMPLE.read_text(), "errors": []})
    r = final["soap_response"]
    plan = r["soap"]["plan"]
    assert r["schema_version"] == "1.0" and r["status"] == "draft"
    assert [m["name"] for m in plan["prescription"]] == ["Paracetamol 500 mg"]
    assert plan["prescription"][0]["linked_symptoms"] == ["fever"]
    assert [m["name"] for m in plan["for_doctor_review"]] == ["Brufen 400mg"]
    rx_info = plan["prescription"][0]["info"]
    assert rx_info["sources"] == ["dawaai", "dvago"]                      # found in BOTH datasets -> merged
    assert rx_info["side_effects"] == "Rash" and rx_info["dosage_reference"] == "500-1000 mg every 6 h"
    assert rx_info["warnings"] == "Dawaai: Liver disease\n\nDVAGO: Do not exceed 4 g/day"
    assert plan["for_doctor_review"][0]["info"]["side_effects"] == "stomach upset"
    assert r["soap"]["medication_history"][0]["medicine_name"] == "Glucophage 500"
    assert {s["symptom"] for s in r["symptoms"]} == {"fever", "headache", "dry cough"}  # denied dropped
    assert r["warnings"] == []


def test_graph_node_failure_is_flagged(monkeypatch):
    pytest.importorskip("langgraph")

    def broken(schema, prompt, transcript):
        if schema is PrescriptionExtraction:
            raise ValueError("LLM down")
        return fake_extract(schema, prompt, transcript)

    for mod in (n1, n2, n3, soap):
        monkeypatch.setattr(mod, "extract", broken)
    monkeypatch.setattr(n1, "embed", lambda texts: [[0.0] * 3 for _ in texts])
    from mediassist_agent.rag import store as store_mod
    monkeypatch.setattr(n1, "SymptomMedicineStore", FakeStore)
    monkeypatch.setattr(store_mod, "SymptomMedicineStore", FakeStore)
    from mediassist_agent.graph import build_graph

    r = build_graph().invoke({"consultation_id": "c2", "raw_transcript": SAMPLE.read_text(), "errors": []})["soap_response"]
    assert r["soap"]["plan"]["prescription"] == []          # nothing fabricated
    assert [w["node"] for w in r["warnings"]] == ["node2_prescription"]


# ---------------------------------------------------------------- merge across datasets
def test_merge_info_both_sources():
    info = merge_info({
        "dvago": {"name": "B", "url": "u2", "info": {"warnings": "W2", "dosage_reference": "D2", "side_effects": "S"}},
        "dawaai": {"name": "A", "url": "u1", "info": {"warnings": "W1", "how_to_use": "H1", "side_effects": "S"}},
    })
    assert info.sources == ["dawaai", "dvago"] and info.urls == ["u1", "u2"]
    assert info.how_to_use == "H1" and info.dosage_reference == "D2"      # each from wherever it exists
    assert info.side_effects == "S"                                      # identical text kept once
    assert info.warnings == "Dawaai: W1\n\nDVAGO: W2"                    # different text: both, labelled
    assert merge_info({}) is None


# ---------------------------------------------------------------- dataset parsing (real files if present)
def test_ingest_prepare_real_files():
    from mediassist_agent.rag.ingest import DATA_DIR, DATASETS, prepare
    pytest.importorskip("openpyxl")
    for src, cfg in DATASETS.items():
        path = DATA_DIR / cfg["file"]
        if not path.exists():
            continue
        products, labels = prepare(src, cfg, path)
        assert len(products) > 1000 and 100 < len(labels) < 2000
        assert all(p["id"].startswith(src + ":") for p in products)
        assert len({p["id"] for p in products}) == len(products)


# ---------------------------------------------------------------- ranking / safety rules
def test_suggestion_filters_and_label_selection():
    from mediassist_agent.rag.ranking import select_labels, suggestible
    assert not suggestible({"name": "Bofalgan IV Infusion 1g"}, "fever")
    assert not suggestible({"name": "Xepat Opthalmic Solution"}, "headache")
    assert suggestible({"name": "Xepat Opthalmic Solution"}, "red itchy eyes")
    assert suggestible({"name": "Panadol Tablets 500mg"}, "fever")
    assert select_labels({"cough": 0.85, "cough relief": 0.82, "fever & cough": 0.70}, 5, 0.10) == \
        {"cough": 0.85, "cough relief": 0.82}


def test_rank_prefers_specific_generic():
    from mediassist_agent.rag.ranking import rank_generics
    rows = [{"id": f"p{i}", "source_dataset": "d", "medicine_name": f"Para {i}", "generic_name": "Paracetamol",
             "generic_norm": "paracetamol", "label": "fever"} for i in range(10)]
    rows += [{"id": f"m{i}", "source_dataset": "d", "medicine_name": f"Melox {i}", "generic_name": "Meloxicam",
              "generic_norm": "meloxicam", "label": "fever"} for i in range(10)]
    # meloxicam has 100 products overall (mostly arthritis); paracetamol 10 - so paracetamol is specific to fever
    out = rank_generics(rows, {"fever": 1.0}, {"paracetamol": 10, "meloxicam": 100}, "fever", 2)
    assert [r["generic_name"] for r in out] == ["Paracetamol", "Meloxicam"]


def test_product_pick_matches_prescribed_form():
    from mediassist_agent.rag.ranking import product_preference
    med = {"name": "Paracetamol", "strength": "500 mg", "route": "oral", "dose": "one tablet"}
    prods = [
        {"id": "a", "name": "Bofalgan IV Infusion 1g/100ml", "info": {"x": 1, "y": 2, "z": 3}},
        {"id": "b", "name": "Panadol Tablets 250mg", "info": {"x": 1}},
        {"id": "c", "name": "Panadol Tablets 500mg", "info": {"x": 1}},
    ]
    assert sorted(prods, key=lambda p: product_preference(p, med))[0]["id"] == "c"


def test_suggestion_sharing_prescribed_ingredient_is_dropped():
    doctor = [PrescribedMedicine(name="Paracetamol", generic_name="Paracetamol")]
    rag = [RagMedicine(record_id="x", name="Amadol Extra", generic_name="Paracetamol (500mg); Caffeine (65mg)",
                       linked_symptoms=["fever"])]
    out = reconcile(doctor, rag)
    assert len(out) == 1 and out[0].tag == "doctor_prescribed" and out[0].linked_symptoms == ["fever"]


def test_review_drops_candidates_and_never_adds(monkeypatch):
    from mediassist_agent.schemas import SuggestionDecision, SymptomMatch
    matches = [SymptomMatch(symptom="dry cough", match_type="exact", medicines=[
        RagMedicine(record_id="a", name="Costa", generic_name="Carbocisteine", linked_symptoms=["dry cough"]),
        RagMedicine(record_id="b", name="Dextro", generic_name="Dextromethorphan", linked_symptoms=["dry cough"]),
    ])]
    review = SuggestionReview(decisions=[
        SuggestionDecision(candidate_id="c1", keep=False, reason="mucolytic, for productive cough"),
        SuggestionDecision(candidate_id="c2", keep=True, reason="cough suppressant fits dry cough"),
        SuggestionDecision(candidate_id="c99", keep=True, reason="invented id must be ignored"),
    ])
    monkeypatch.setattr(n1, "extract", lambda *a, **k: review)
    sym = [ExtractedSymptom(mention="dry cough", status="present", standardized="dry cough")]
    n1._review(matches, sym, "Patient: dry cough", 0)
    assert [m.name for m in matches[0].medicines] == ["Dextro"]
    assert matches[0].medicines[0].review_reason == "cough suppressant fits dry cough"


def test_continued_medicine_is_tagged():
    doctor = [PrescribedMedicine(name="Glucophage 500", frequency="twice a day", prescription_status="continued")]
    out = reconcile(doctor, [])
    assert out[0].tag == "doctor_prescribed" and out[0].prescription_status == "continued"


# ---------------------------------------------------------------- anti-hallucination checks
def test_grounding_checks():
    from mediassist_agent.grounding import Transcript
    tx = Transcript(SAMPLE.read_text(encoding="utf-8"))
    assert tx.has_name("Paracetamol 500 mg") and tx.has_name("Glucophage") and tx.has_name("Paracetmol")  # typo ok
    assert not tx.has_name("Amoxil")                                   # never mentioned
    assert tx.has_numbers("1 tablet") and tx.has_numbers("5 days")    # "one tablet", "five days" in transcript
    assert not tx.has_numbers("10 days")
    assert tx.has_quote("I took Panadol yesterday, two times.")
    assert not tx.has_quote("Patient is allergic to penicillin.")


def test_node2_removes_invented_medicine_and_clears_invented_numbers(monkeypatch):
    invented = PrescriptionExtraction(medicines=[
        PrescribedMedicine(name="Paracetamol 500 mg", dose="1 tablet", duration="10 days"),  # 10 never said
        PrescribedMedicine(name="Amoxil", dose="1 capsule"),                                 # never mentioned
    ])
    monkeypatch.setattr(n2, "extract", lambda *a, **k: invented)
    text, _ = cleaning.clean_transcript(SAMPLE.read_text(encoding="utf-8"))
    out = n2.node2_prescription({"transcript": text})
    assert [m["name"] for m in out["prescribed_medicines"]] == ["Paracetamol 500 mg"]
    assert out["prescribed_medicines"][0]["duration"] is None and out["prescribed_medicines"][0]["dose"] == "1 tablet"
    assert len(out["errors"]) == 2 and all(e["kind"] == "verification" for e in out["errors"])


def test_frequency_word_cannot_justify_a_count():
    from mediassist_agent.grounding import Transcript
    text, _ = cleaning.clean_transcript(SAMPLE.read_text(encoding="utf-8"))
    tx = Transcript(text)
    # "Glucophage 500 twice a day": twice is a frequency (2x), not "two tablets"
    assert not tx.numbers_in_context("two tablets", "Glucophage")
    assert tx.numbers_in_context("twice a day", "Glucophage")
    assert tx.numbers_in_context("500 mg", "Glucophage")
    # Paracetamol line: "one tablet three times a day ... for five days"
    assert tx.numbers_in_context("1 tablet", "Paracetamol") and tx.numbers_in_context("3 times a day", "Paracetamol")
    assert tx.numbers_in_context("5 days", "Paracetamol")
    assert not tx.numbers_in_context("7 days", "Paracetamol")


# ---------------------------------------------------------------- evaluation scorer
def test_eval_scorer_flags_forbidden_and_invented():
    import json as _json
    from eval.run_eval import CASES_DIR, score_case
    expected = _json.loads((CASES_DIR / "01_viral_fever.expected.json").read_text(encoding="utf-8"))
    state = {
        "symptoms": [{"standardized": "fever", "mention": "fever"}, {"standardized": "headache", "mention": "bad headache"},
                     {"standardized": "dry cough", "mention": "dry cough"}, {"standardized": "vomiting", "mention": "vomiting"}],
        "reconciled_medicines": [
            {"name": "Paracetamol", "generic_name": "Paracetamol", "tag": "doctor_prescribed", "strength": "500 mg",
             "dose": "one tablet", "frequency": "three times a day", "duration": "five days", "prescription_status": "new"},
            {"name": "Glucophage", "generic_name": "Metformin HCl", "tag": "doctor_prescribed", "strength": "500 mg",
             "dose": "two tablets", "frequency": "twice a day", "prescription_status": "continued"},
            {"name": "Hydryllin", "tag": "doctor_prescribed"},
        ],
        "medical_history": [{"condition": "diabetes", "medicine_name": "Glucophage 500"}, {"medicine_name": "Panadol"}],
        "errors": [],
    }
    r = score_case(expected, state)
    assert r["symptom_recall"] == (3, 3) and r["symptoms_wrongly_present"] == ["vomiting"]
    assert r["rx_recall"] == (2, 2) and r["rx_forbidden"] == ["Hydryllin"]
    assert r["rx_invented_fields"] == ["Glucophage.dose='two tablets'"]
    assert r["history_recall"] == (2, 2)


def test_every_eval_case_has_valid_expectations():
    import json as _json
    from eval.run_eval import CASES_DIR
    cases = sorted(CASES_DIR.glob("*.txt"))
    assert len(cases) >= 15
    for c in cases:
        exp = _json.loads(c.with_suffix(".expected.json").read_text(encoding="utf-8"))
        assert {"symptoms_present", "prescribed", "not_prescribed", "history"} <= set(exp)
        text = c.read_text(encoding="utf-8").lower()
        for m in exp["prescribed"]:   # every expected prescription is really in the transcript
            assert any(n.lower().split()[0] in text for n in [m["name"]] + m.get("aliases", [])), (c.name, m["name"])
        for n in exp["not_prescribed"]:
            assert n.lower() in text, (c.name, n)


def test_null_strings_from_llm_become_real_nulls():
    # gpt-4o-mini sometimes sends status: "null" (a string) - this crashed Node 3 before
    h = HistoryExtraction.model_validate({"items": [{"condition": "stomach ulcer", "status": "null", "reason": "N/A"}]})
    assert h.items[0].status is None and h.items[0].reason is None and h.items[0].condition == "stomach ulcer"


def test_frequency_in_dose_field_is_moved():
    from mediassist_agent.nodes.node2_prescription import _fix_misplaced_frequency
    m = PrescribedMedicine(name="Glucophage", dose="twice a day")
    _fix_misplaced_frequency(m)
    assert m.dose is None and m.frequency == "twice a day"
    m = PrescribedMedicine(name="Panadol", dose="2 tablets", frequency="three times a day")
    _fix_misplaced_frequency(m)
    assert m.dose == "2 tablets"                       # a real dose is never touched


def test_combo_product_does_not_become_the_info_source():
    doctor = [PrescribedMedicine(name="Paracetamol", generic_name="Paracetamol")]
    rag = [RagMedicine(record_id="amadol", name="Amadol Extra", generic_name="Paracetamol (500mg); Caffeine (65mg)",
                       linked_symptoms=["fever"])]
    out = reconcile(doctor, rag)
    assert len(out) == 1 and out[0].linked_symptoms == ["fever"] and out[0].record_id is None
