"""The single LangGraph workflow.

                 START
                   |
                 clean            (RE cleaning)
          /        |        \\
     node1       node2      node3       <- run in PARALLEL (independent)
   (symptoms   (prescription) (history)
     + RAG)        |           |
          \\       /            |
           node4 (compare + info)        <- waits for node1 AND node2
                   \\          /
                     soap               <- waits for node4 AND node3
                       |
                      END  -> soap_response (JSON for the front end)
"""
from __future__ import annotations

from functools import lru_cache

from langgraph.graph import END, START, StateGraph

from .nodes.clean import clean_node
from .nodes.node1_symptoms_rag import node1_symptoms_rag
from .nodes.node2_prescription import node2_prescription
from .nodes.node3_history import node3_history
from .nodes.node4_compare import node4_compare
from .nodes.soap import soap_node
from .state import AgentState


def _after_clean(state: dict):
    # Empty transcript -> skip the LLM nodes and return a SOAP response that only carries the warning.
    return ["node1", "node2", "node3"] if state.get("transcript") else ["soap"]


def build_graph():
    g = StateGraph(AgentState)
    g.add_node("clean", clean_node)
    g.add_node("node1", node1_symptoms_rag)
    g.add_node("node2", node2_prescription)
    g.add_node("node3", node3_history)
    g.add_node("node4", node4_compare)
    g.add_node("soap", soap_node)

    g.add_edge(START, "clean")
    g.add_conditional_edges("clean", _after_clean, ["node1", "node2", "node3", "soap"])
    g.add_edge(["node1", "node2"], "node4")   # fan-in: Node 4 waits for both
    g.add_edge(["node3", "node4"], "soap")    # fan-in: SOAP waits for history + reconciled list
    g.add_edge("soap", END)
    return g.compile()


@lru_cache(maxsize=1)
def get_graph():
    return build_graph()


def run_consultation(raw_transcript: str, consultation_id: str,
                     patient_id: str | None = None, doctor_id: str | None = None) -> dict:
    """Run the whole workflow on one transcript and return the SOAP JSON response."""
    final = get_graph().invoke({
        "consultation_id": consultation_id,
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "raw_transcript": raw_transcript,
        "errors": [],
    })
    return final["soap_response"]
