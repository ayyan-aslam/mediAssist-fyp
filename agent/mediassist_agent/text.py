"""Shared text normalisation (used by the ingest, Node 1 and Node 4 so they always agree)."""
from __future__ import annotations

import re

_FORMS = (
    r"\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syp|syrup|susp|suspension|inj|injection|infusion|"
    r"drop|drops|eye|ear|nasal|cream|gel|ointment|lotion|sachet|sachets|powder|spray|inhaler|vial|ampoule|"
    r"mg|mcg|ml|g|gm|iu|forte|plus|ds|sr|xr|er|cr|mr|dt|s)\b"
)


def normalise_symptom(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip()


def norm_name(name: str | None) -> str:
    """'Tab. Panadol 500mg' -> 'panadol'; 'Augmentin 625 mg' -> 'augmentin'."""
    if not name:
        return ""
    n = name.lower()
    n = re.sub(r"\([^)]*\)", " ", n)                       # "(500mg)"
    n = re.sub(r"\d+(\.\d+)?\s*(mg|mcg|ml|g|gm|iu|%)?", " ", n)
    n = re.sub(_FORMS, " ", n)
    n = re.sub(r"[^a-z ]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def norm_generic(generic: str | None) -> str:
    """'Artemether (15mg); Lumefantrine (90mg)' -> 'artemether + lumefantrine' (sorted, order-independent).

    A single ingredient normalises exactly like norm_name, so a doctor saying "Paracetamol"
    matches a dataset generic "Paracetamol (500mg)".
    """
    if not generic:
        return ""
    g = re.sub(r"\([^)]*\)", " ", generic)
    parts = set()
    for p in re.split(r"[;,+/&]|\band\b", g):
        n = norm_name(p)
        n = _SALTS.sub(" ", n).strip() or n          # "metformin hcl" -> "metformin"
        n = re.sub(r"\s+", " ", n)
        n = _SYNONYMS.get(n, n)
        for piece in n.split(" + "):
            if piece:
                parts.add(piece)
    return " + ".join(sorted(parts))


# Salt / hydrate words that don't change which medicine it is.
_SALTS = re.compile(
    r"\b(hcl|hydrochloride|hbr|hydrobromide|maleate|fumarate|succinate|tartrate|mesylate|mesilate|besylate|"
    r"besilate|trihydrate|monohydrate|dihydrate|anhydrous|bp|usp)\b"
)
# Same medicine, different names (extend while evaluating; spelling mistakes seen in the datasets included).
_SYNONYMS = {
    "co amoxiclav": "amoxicillin + clavulanic acid",
    "amoxicllin": "amoxicillin",
    "amoxycillin": "amoxicillin",
    "clavulanate": "clavulanic acid",
    "potassium clavulanate": "clavulanic acid",
    "acetaminophen": "paracetamol",
    "esomeperazole": "esomeprazole",
    "salbutamol sulphate": "salbutamol",
    "salbutamol sulfate": "salbutamol",
}
