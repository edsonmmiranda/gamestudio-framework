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

    def test_expansion_in_a_dotenv_file_is_refused_not_sent_literally(self):
        self.write(".env.local", "BASE=https://a.test\nVITE_URL=${BASE}/v1\n")
        values, _, missing = build_env.resolve({"env": {"VITE_URL": None}}, self.dir, environ={})
        self.assertEqual(values, {})
        self.assertEqual(len(missing), 1)
        self.assertTrue(missing[0].startswith("VITE_URL (usa ${"))

    def test_every_form_vite_replaces_is_a_reference(self):
        self.write("src/a.js", "const a = import.meta.env.VITE_A, b = import.meta.env?.VITE_B;\n"
                   "const c = import.meta.env['VITE_C'], d = import.meta.env?.[\"VITE_D\"];\n"
                   "const { VITE_E, MODE, VITE_F: f } = import.meta.env;\n")
        self.write("index.html", "<title>%VITE_TITLE%</title>")
        self.write("build/gerado.js", "import.meta.env.VITE_EM_BUILD")
        self.write("tests/a.test.js", "import.meta.env.VITE_SO_TESTE")
        self.write("vite.config.mjs", "define: { 'import.meta.env.VITE_A': JSON.stringify('x') }")
        self.assertEqual(build_env.referenced(self.dir),
                         {"VITE_B", "VITE_C", "VITE_D", "VITE_E", "VITE_F", "VITE_TITLE", "VITE_EM_BUILD"})

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
