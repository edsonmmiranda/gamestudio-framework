"""`references` no config.json do laboratório: o context lista nó e notas do cérebro, bibliotecas e anatomias."""
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

FRAMEWORK = Path(__file__).resolve().parents[1]
SCRIPT = FRAMEWORK / "scripts/game.py"
SPEC = importlib.util.spec_from_file_location("game_harness_references", SCRIPT)
game = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(game)
KIT = FRAMEWORK / "assets/cerebro/_sistema"


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def find_check(payload, name):
    if isinstance(payload, dict):
        if payload.get("name") == name:
            return payload
        for value in payload.values():
            found = find_check(value, name)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = find_check(value, name)
            if found:
                return found
    return None


class ReferencesTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="games-references-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        env = patch.dict(os.environ, {"GAMES_WORKSPACE_ROOT": str(self.root)})
        env.start()
        self.addCleanup(env.stop)
        self.project = self.root / "games/demo"
        write(self.project / "package.json", '{"name":"demo","scripts":{}}')
        write(self.project / "AGENTS.md",
              "Critério de igual: a bancada `libraries/demo-lab` e a anatomia em outputs/decoded/demo.\n")
        write(self.project / "README.md",
              "# Demo\n\nA folha de referência cita libraries/demo-lab@abc123, libraries/sumida e a bancada "
              "libraries/ferramenta.\n")
        # O AGENTS do laboratório cita uma biblioteca como exemplo: isso não é declaração do jogo.
        write(self.root / "AGENTS.md", "Regra do laboratório: use caminhos como `libraries/outra-lab`.\n")
        write(self.root / "libraries/demo-lab/library.json", json.dumps({
            "schemaVersion": "1.0.0", "projectId": "demo-lab", "label": "Demo Lab", "mode": "reference",
            "snapshot": {"id": "build-1", "revision": "1.0 (Steam 1)", "sourceDigest": "0" * 64},
            "capabilities": {
                "inspect": {"status": "supported", "reason": "tabelas lidas"},
                "runtime": {"status": "unsupported", "reason": "cliente fechado"},
            },
            "scope": "Elenco e mapas.",
        }))
        write(self.root / "libraries/demo-own/library.json", json.dumps({
            "projectId": "demo", "label": "Demo — biblioteca", "mode": "own",
            "snapshot": {"id": "own-1", "revision": "commit abc"},
            "capabilities": {"preview": {"status": "partial", "reason": "sem áudio"}},
        }))
        write(self.root / "libraries/outra-lab/library.json", json.dumps({
            "projectId": "outra", "label": "Outra", "mode": "reference", "snapshot": {"id": "x"}, "capabilities": {},
        }))
        write(self.root / "libraries/ferramenta/README.md", "bancada comum, sem manifesto\n")
        (self.root / "outputs/decoded/demo/anatomia").mkdir(parents=True)
        (self.root / "outputs/decoded/outra/anatomia").mkdir(parents=True)
        (self.root / "outputs/decoded/sem-fatos").mkdir(parents=True)
        self.vault = self.root / "docs"
        shutil.copytree(KIT, self.vault / "_sistema", ignore=shutil.ignore_patterns("__pycache__"))
        write(self.vault / "genealogia-jogos/nos/jogos/Demo.md",
              "---\ntipo: jogo\nano: 2026\nprojeto: games/demo\ntags:\n  - nosso\n---\n# Demo\n\nNó de teste.\n")
        write(self.vault / "estudos/Estudo Exemplo.md",
              '---\ntipo: estudo\nresumo: "Estudo ligado ao Demo."\njogos:\n  - "[[Demo]]"\ntemas:\n  - design\n'
              'status: vigente\ndata: 2026-09-28\n---\n# Estudo Exemplo\n\nCorpo.\n')
        write(self.vault / "estudos/Estudo Alheio.md",
              '---\ntipo: estudo\nresumo: "Sem jogo."\ntemas:\n  - design\nstatus: vigente\ndata: 2026-09-28\n---\n'
              '# Estudo Alheio\n\nCorpo.\n')
        self.configure({"studies": "docs", "libraries": "libraries", "anatomy": "outputs/decoded"})

    def configure(self, references):
        data = {"version": 1, "context_files": []}
        if references is not None:
            data["references"] = references
        write(self.root / "framework/config.json", json.dumps(data))

    def context(self, project=None):
        return game.context(project or self.project, "create", root=self.root)

    def test_profile_resolves_reference_roots_inside_the_workspace(self):
        profile = game.workspace_profile(self.root)
        self.assertEqual(set(profile["references"]), {"studies", "libraries", "anatomy"})
        self.assertEqual(profile["references"]["libraries"],
                         {"path": str(self.root / "libraries"), "relative": "libraries", "exists": True})
        self.configure({"studies": "docs", "libraries": "./libraries/", "anatomy": "outputs/nada"})
        profile = game.workspace_profile(self.root)
        self.assertEqual(profile["references"]["libraries"]["relative"], "libraries")
        self.assertFalse(profile["references"]["anatomy"]["exists"])

    def test_profile_rejects_unknown_kind_escape_and_wrong_shape(self):
        for bad, message in (
            ({"catalogs": "docs"}, "referência desconhecida"),
            ({"studies": "../fora"}, "fora do workspace"),
            (["docs"], "objeto"),
            ({"studies": ""}, "objeto"),
        ):
            with self.subTest(bad=bad):
                self.configure(bad)
                with self.assertRaisesRegex(ValueError, message):
                    game.workspace_profile(self.root)

    def test_context_without_the_key_is_not_configured(self):
        self.configure(None)
        report = self.context()
        self.assertEqual(report["references"]["status"], "not_configured")
        self.assertIn('"references"', report["references"]["how_to"])
        self.assertEqual(report["workspace"]["references"], {})
        self.assertTrue(any("references" in limit for limit in report["limits"]))

    def test_context_lists_libraries_the_game_cites_and_the_own_library_that_projects_it(self):
        libraries = self.context()["references"]["libraries"]
        self.assertEqual(libraries["status"], "listed")
        self.assertEqual((libraries["folders"], libraries["available"]), (4, 3))
        related = {item["name"]: item for item in libraries["related"]}
        self.assertEqual(set(related), {"demo-lab", "demo-own", "ferramenta"})
        bench = related["ferramenta"]  # citada pelo jogo, sem manifesto: entra com o mesmo formato
        self.assertEqual((bench["status"], bench["manifest"], bench["mode"]), ("no_manifest", None, None))
        self.assertEqual(set(bench), set(related["demo-lab"]))
        lab = related["demo-lab"]
        self.assertEqual(lab["relation"], {"kind": "mentioned_by_game", "path": str(self.project / "AGENTS.md"), "line": 1})
        self.assertEqual(lab["mode"], "reference")
        self.assertEqual(lab["snapshot"], {"id": "build-1", "revision": "1.0 (Steam 1)"})
        self.assertEqual(lab["capabilities"], {"inspect": "supported", "runtime": "unsupported"})
        self.assertEqual(lab["scope"], "Elenco e mapas.")
        self.assertEqual(lab["manifest"], str(self.root / "libraries/demo-lab/library.json"))
        own = related["demo-own"]
        self.assertEqual(own["relation"], {
            "kind": "projects_game", "path": str(self.root / "libraries/demo-own/library.json"),
            "line": None, "basis": "projectId",
        })
        self.assertEqual(libraries["mentioned_missing"],
                         [{"name": "sumida", "path": str(self.project / "README.md"), "line": 3}])

    def test_lab_level_instructions_do_not_link_a_game_to_a_library(self):
        related = {item["name"] for item in self.context()["references"]["libraries"]["related"]}
        self.assertNotIn("outra-lab", related)

    def test_own_library_is_related_by_the_game_path_in_its_documents(self):
        write(self.root / "libraries/demo-own/library.json",
              json.dumps({"projectId": "familia", "mode": "own", "snapshot": {}, "capabilities": {}}))
        write(self.root / "libraries/demo-own/mandate.md",
              "# Mandato\n\nFontes: games/demo no commit abc e games/demo-2 fora do recorte.\n")
        related = {item["name"]: item for item in self.context()["references"]["libraries"]["related"]}
        self.assertEqual(related["demo-own"]["relation"], {
            "kind": "projects_game", "path": str(self.root / "libraries/demo-own/mandate.md"),
            "line": 3, "basis": "path",
        })

    def test_context_lists_cited_anatomies_with_their_fact_bases(self):
        anatomy = self.context()["references"]["anatomy"]
        self.assertEqual(anatomy["status"], "listed")
        self.assertEqual(anatomy["available"], 2)
        self.assertEqual(anatomy["related"], [{
            "name": "demo", "path": str(self.root / "outputs/decoded/demo"), "exists": True,
            "facts": str(self.root / "outputs/decoded/demo/anatomia"),
            "relation": {"kind": "mentioned_by_game", "path": str(self.project / "AGENTS.md"), "line": 1},
        }])

    def test_context_lists_the_node_and_the_notes_of_the_game_from_the_vault(self):
        studies = self.context()["references"]["studies"]
        self.assertEqual(studies["status"], "listed", studies)
        self.assertEqual(studies["node"], str(self.vault / "genealogia-jogos/nos/jogos/Demo.md"))
        self.assertEqual([note["path"] for note in studies["notes"]], [str(self.vault / "estudos/Estudo Exemplo.md")])
        note = studies["notes"][0]
        self.assertEqual((note["type"], note["status"], note["summary"]), ("estudo", "vigente", "Estudo ligado ao Demo."))
        self.assertEqual(note["games"], ["[[Demo]]"])
        self.assertEqual((studies["count"], studies["by_type"]), (1, {"estudo": 1}))
        self.assertIn("buscar --jogo games/demo --json", studies["command"])

    def test_game_without_a_node_and_vault_without_the_kit_are_reported_not_invented(self):
        other = self.root / "games/outro"
        write(other / "package.json", "{}")
        studies = self.context(other)["references"]["studies"]
        self.assertEqual(studies["status"], "game_not_in_vault")
        self.assertIn("não encontrado", studies["message"])
        self.assertEqual((studies["notes"], studies["node"]), ([], None))
        shutil.rmtree(self.vault / "_sistema")
        studies = self.context()["references"]["studies"]
        self.assertEqual(studies["status"], "tool_missing")
        self.configure({"studies": "cerebro-ausente"})
        studies = self.context()["references"]["studies"]
        self.assertEqual(studies["status"], "root_missing")

    def test_cli_and_doctor_report_the_reference_roots(self):
        env = {**os.environ, "GAMES_WORKSPACE_ROOT": str(self.root)}
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "context", str(self.project), "--focus", "create", "--root", str(self.root)],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["references"]["status"], "listed")
        self.assertEqual({item["name"] for item in data["references"]["libraries"]["related"]},
                         {"demo-lab", "demo-own", "ferramenta"})
        self.configure({"studies": "docs", "libraries": "libraries", "anatomy": "outputs/nada"})
        result = subprocess.run([sys.executable, str(SCRIPT), "doctor", "--root", str(self.root)],
                                capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(find_check(report, "references.libraries")["status"], "ok")
        missing = find_check(report, "references.anatomy")
        self.assertEqual(missing["status"], "optional")
        self.assertIn("ausente", missing["detail"])
        self.assertIn("references.anatomy", missing["fix"])


if __name__ == "__main__":
    unittest.main()
