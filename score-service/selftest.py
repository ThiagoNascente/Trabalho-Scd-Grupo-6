# ==========================================================================
# Selftest OFFLINE da política de ranking (sem Redis/Kafka/PostgreSQL).
#
# Valida `store.leaderboard_ops` (função pura) e aplica as operações em um Redis
# falso em memória, conferindo o ranking resultante por minigame. Serve para
# validar a lógica neste ambiente (sem Docker), antes do teste E2E na nuvem.
#
#   python selftest.py
# ==========================================================================
from store import leaderboard_ops, leaderboard_key


class FakeRedis:
    """Mínimo de um sorted set para o teste: ZINCRBY, ZADD GT, ZREVRANGE."""
    def __init__(self):
        self.z = {}  # key -> {member: score}

    def zincrby(self, key, amount, member):
        self.z.setdefault(key, {})
        self.z[key][member] = self.z[key].get(member, 0) + amount

    def zadd_gt(self, key, member, value):
        self.z.setdefault(key, {})
        cur = self.z[key].get(member)
        if cur is None or value > cur:
            self.z[key][member] = value

    def top(self, key, n=10):
        items = sorted(self.z.get(key, {}).items(), key=lambda kv: kv[1], reverse=True)
        return [{"username": m, "score": int(s)} for m, s in items[:n]]


def apply(fake, event):
    for op in leaderboard_ops(event):
        if op["op"] == "zincrby":
            fake.zincrby(op["key"], op["value"], op["member"])
        elif op["op"] == "zadd_gt":
            fake.zadd_gt(op["key"], op["member"], op["value"])


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print(f"  ok: {msg}")


def main():
    r = FakeRedis()

    # --- Jogo 1 (PvP): ranking conta VITÓRIAS ---
    apply(r, {"game": "jogo1", "players": [
        {"username": "alice", "score": 3, "won": True},
        {"username": "bob", "score": 0, "won": False},
    ]})
    apply(r, {"game": "jogo1", "players": [
        {"username": "alice", "score": 3, "won": True},
        {"username": "bob", "score": 0, "won": False},
    ]})
    top1 = r.top(leaderboard_key("jogo1"))
    expect(top1[0] == {"username": "alice", "score": 2}, "jogo1: alice com 2 vitórias no topo")
    expect(all(e["username"] != "bob" for e in top1), "jogo1: perdedor (bob) não pontua")

    # --- Jogo 2 (cooperativo): ranking mantém a MELHOR pontuação ---
    apply(r, {"game": "jogo2", "players": [{"username": "alice", "score": 40, "won": False}]})
    apply(r, {"game": "jogo2", "players": [{"username": "alice", "score": 25, "won": False}]})  # pior: ignora
    apply(r, {"game": "jogo2", "players": [{"username": "carol", "score": 70, "won": False}]})
    top2 = r.top(leaderboard_key("jogo2"))
    expect(top2[0] == {"username": "carol", "score": 70}, "jogo2: carol (70) no topo")
    expect({"username": "alice", "score": 40} in top2, "jogo2: alice mantém o MELHOR (40), não o último (25)")

    # --- Jogo 3 (cooperativo): pontuação compartilhada vai p/ cada jogador ---
    apply(r, {"game": "jogo3", "players": [
        {"username": "alice", "score": 530, "won": True},
        {"username": "dave", "score": 530, "won": True},
    ]})
    top3 = r.top(leaderboard_key("jogo3"))
    expect({"username": "alice", "score": 530} in top3, "jogo3: alice com 530")
    expect({"username": "dave", "score": 530} in top3, "jogo3: dave com 530 (mesma run)")

    # --- Robustez: jogador sem username é ignorado ---
    apply(r, {"game": "jogo2", "players": [{"username": "", "score": 999, "won": False}]})
    top2b = r.top(leaderboard_key("jogo2"))
    expect(all(e["score"] != 999 for e in top2b), "evento sem username é ignorado")

    print("\nSELFTEST OK — política de ranking por minigame validada.")


if __name__ == "__main__":
    main()
