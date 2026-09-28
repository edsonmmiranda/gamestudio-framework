"""Ambiente de build declarado no deploy: leitura, precedência e conferência no build."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_env


class BuildEnvTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.dir = Path(self.temp.name)

    def write(self, rel, text):
        path = self.dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def test_dotenv_quotes_export_and_comments(self):
        self.write(".env", '# nota\nexport A="x y"\nB=\'z\'\nC=plain # comentário\nD=\nruim\n')
        self.assertEqual(build_env.read_dotenv(self.dir / ".env"), {"A": "x y", "B": "z", "C": "plain", "D": ""})

    def test_fixed_value_wins_then_environment_then_vite_file_order(self):
        self.write(".env", "M=env\nN=env\nO=env\n")
        self.write(".env.local", "M=local\nN=local\nSEGREDO=x\n")
        self.write(".env.production.local", "M=prod-local\n")
        config = {"env": {"M": None, "N": None, "O": None, "P": None, "F": "1", "OFF": ""}}
        values, sources, missing = build_env.resolve(config, self.dir, environ={"O": "shell", "F": "shell"})
        self.assertEqual(values, {"M": "prod-local", "N": "local", "O": "shell", "F": "1", "OFF": ""})
        self.assertEqual(sources["M"], ".env.production.local")
        self.assertEqual(sources["F"], "workspace.json")
        self.assertEqual(missing, ["P"])
        self.assertNotIn("SEGREDO", values)

    def test_invalid_declaration(self):
        for env in ([], {"a-b": None}, {"A": 1}):
            with self.assertRaises(ValueError):
                build_env.declared({"env": env})
        self.assertEqual(build_env.declared({}), {})

    def test_only_non_empty_vite_values_are_expected_in_the_build(self):
        self.assertEqual(build_env.expected({"VITE_A": "u", "VITE_OFF": "", "FIXO": "1"}), {"VITE_A": "u"})

    def test_missing_in_build_reads_js_and_html(self):
        self.write("dist/index.html", "<meta content='https://a.test'>")
        self.write("dist/assets/x.js", 'k="sb_publishable_abc"')
        self.write("dist/data.json", '"sb_publishable_zzz"')
        found = build_env.missing_in_build(self.dir / "dist", {
            "VITE_URL": "https://a.test", "VITE_KEY": "sb_publishable_abc", "VITE_OUTRA": "sb_publishable_zzz"})
        self.assertEqual(found, ["VITE_OUTRA"])


if __name__ == "__main__":
    unittest.main()
