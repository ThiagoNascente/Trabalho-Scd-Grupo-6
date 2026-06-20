# ==========================================================================
# Selftest do DATASET de teste versionado (req. 4.8) — OFFLINE.
#
# Aplica os eventos de test-data/sample-match-events.json na política de ranking
# do Score Service (store.leaderboard_ops, função pura) e confere o resultado
# contra o oráculo test-data/expected-rankings.json. Não precisa de Kafka/Redis/
# PostgreSQL — usa o mesmo FakeRedis do selftest.py.
#
#   python selftest_dataset.py
# ==========================================================================
import json
import os

from store import leaderboard_key
from selftest import FakeRedis, apply

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "test-data")


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as f:
        return json.load(f)


def main():
    events = load("sample-match-events.json")["events"]
    expected = load("expected-rankings.json")["rankings"]

    r = FakeRedis()
    for ev in events:
        apply(r, ev)

    failures = 0
    for game, exp_rank in expected.items():
        got = r.top(leaderboard_key(game), n=len(exp_rank))
        if got == exp_rank:
            print(f"  ok: {game} -> {got}")
        else:
            failures += 1
            print(f"  FALHOU: {game}\n     esperado: {exp_rank}\n     obtido:   {got}")

    if failures:
        raise SystemExit(f"\nSELFTEST DATASET FALHOU em {failures} minigame(s).")
    print("\nSELFTEST DATASET OK — fixture de teste casa com a política de ranking do Score Service.")


if __name__ == "__main__":
    main()
