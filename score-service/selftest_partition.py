# ==========================================================================
# Selftest do PARTICIONAMENTO por minigame (item 11) — OFFLINE.
#
# Valida (1) o roteamento lógico game -> partição e (2) que o fixture de teste
# (test-data/sample-match-events.json) se distribui pelas partições esperadas.
# Não precisa de PostgreSQL — o roteamento físico é feito pelo próprio Postgres
# no INSERT; aqui conferimos a função `partition_for` e a distribuição. O teste
# E2E com pruning real (EXPLAIN) roda na fase Docker/AWS.
#
#   python selftest_partition.py
# ==========================================================================
import json
import os
from collections import Counter

from store import partition_for, PARTITIONS, DEFAULT_PARTITION

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "test-data")


def expect(cond, msg):
    if not cond:
        raise SystemExit(f"FALHOU: {msg}")
    print(f"  ok: {msg}")


def main():
    # 1) Roteamento básico: cada jogo na sua partição; desconhecido na DEFAULT.
    expect(partition_for("jogo1") == "scores_jogo1", "jogo1 -> scores_jogo1")
    expect(partition_for("jogo2") == "scores_jogo2", "jogo2 -> scores_jogo2")
    expect(partition_for("jogo3") == "scores_jogo3", "jogo3 -> scores_jogo3")
    expect(partition_for("jogo_futuro") == DEFAULT_PARTITION,
           f"minigame desconhecido -> {DEFAULT_PARTITION} (partição DEFAULT)")
    expect(len(set(PARTITIONS.values())) == len(PARTITIONS),
           "cada minigame tem uma partição física distinta")

    # 2) Distribuição do fixture entre as partições (1 linha por jogador/evento).
    with open(os.path.join(DATA, "sample-match-events.json"), encoding="utf-8") as f:
        events = json.load(f)["events"]
    dist = Counter()
    for ev in events:
        part = partition_for(ev["game"])
        for p in ev.get("players", []):
            if p.get("username"):
                dist[part] += 1
    print(f"  distribuição do fixture por partição: {dict(dist)}")
    expect(dist["scores_jogo1"] == 6, "scores_jogo1 recebe as 6 linhas dos 3 duelos do fixture")
    expect(dist["scores_jogo2"] == 5, "scores_jogo2 recebe as 5 linhas do fixture")
    expect(dist["scores_jogo3"] == 3, "scores_jogo3 recebe as 3 linhas do fixture")
    expect(dist[DEFAULT_PARTITION] == 0, "nenhuma linha do fixture cai na DEFAULT")

    print("\nSELFTEST PARTIÇÃO OK — roteamento por minigame validado.")


if __name__ == "__main__":
    main()
