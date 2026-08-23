/**
 * What a command line gives up, and what it does not.
 *
 * Half of this file asserts the blind spots. `shell-writes.mjs` lists what it
 * cannot see, and a list of limitations that nothing checks is a list that
 * quietly stops being true — either because a pattern widened and started
 * guessing, or because the comment was copied from an earlier version. Each
 * "cannot see" entry has a test here, and it asserts *no target* rather than a
 * wrong one: naming the wrong file is worse than naming none.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { shellWrites } from "./shell-writes.mjs";

const NL = String.fromCharCode(10);
const DOLLAR = String.fromCharCode(36);
const BACKSLASH = String.fromCharCode(92);
const cmd = (...lines) => lines.join(NL);

/** The one target a command was expected to produce. */
const only = (command) => {
  const targets = shellWrites(command);
  assert.equal(targets.length, 1, `expected one target, got ${JSON.stringify(targets)}`);
  return targets[0];
};

// --- the shape the automatic mode actually writes with ---

test("a heredoc carries both the file and its text", () => {
  const t = only(cmd("cat > src/lib/a.mjs <<'EOF'", "export const a = 1;", "EOF"));
  assert.deepEqual(t, {
    path: "src/lib/a.mjs",
    text: "export const a = 1;" + NL,
    mode: "replace",
    form: "heredoc",
  });
});

test("the redirect is found on either side of the delimiter", () => {
  const before = only(cmd("cat > src/lib/a.mjs <<'EOF'", "x", "EOF"));
  const after = only(cmd("cat <<'EOF' > src/lib/a.mjs", "x", "EOF"));
  assert.deepEqual(before, after);
});

test("an append is an append, so the size gate can add it to what is there", () => {
  assert.equal(only(cmd("cat >> src/lib/a.mjs <<'EOF'", "x", "EOF")).mode, "append");
  assert.equal(only(cmd("tee -a src/lib/a.mjs <<'EOF'", "x", "EOF")).mode, "append");
  assert.equal(only(cmd("tee src/lib/a.mjs <<'EOF'", "x", "EOF")).mode, "replace");
});

test("the tab-stripping and double-quoted delimiter forms are read too", () => {
  assert.equal(only(cmd("cat > a.mjs <<-'EOF'", "\tx", "\tEOF")).text, "\tx" + NL);
  assert.equal(only(cmd('cat > a.mjs <<"EOF"', "x", "EOF")).text, "x" + NL);
});

test("an empty heredoc still names its file, with empty text rather than none", () => {
  const t = only(cmd("cat > src/lib/a.mjs <<'EOF'", "EOF"));
  assert.equal(t.text, "");
  assert.equal(t.mode, "replace");
});

test("a mismatched quote is not a quoted delimiter, and the body is not trusted", () => {
  // `<<'EOF"` opens a delimiter of `EOF"`, so the terminator below does not end
  // it and the body on the command line is not the body that lands. The
  // backreference is what keeps the two quotes the same character. The file is
  // still named — it is written either way — with the text withheld.
  const t = only(cmd("cat > a.mjs <<'EOF\"", "x", "EOF"));
  assert.equal(t.path, "a.mjs");
  assert.equal(t.text, null);
});

test("several files in one command line are all named", () => {
  const targets = shellWrites(
    cmd("cat > src/lib/a.mjs <<'EOF'", "x", "EOF", "cat > src/lib/b.mjs <<'EOF'", "y", "EOF"),
  );
  assert.deepEqual(
    targets.map((t) => [t.path, t.text]),
    [
      ["src/lib/a.mjs", "x" + NL],
      ["src/lib/b.mjs", "y" + NL],
    ],
  );
});

// --- PowerShell ---

test("a here-string piped into Set-Content is as readable as a heredoc", () => {
  const t = only(cmd("@'", "export const a = 1;", "'@ | Set-Content src/lib/a.mjs"));
  assert.deepEqual(t, {
    path: "src/lib/a.mjs",
    text: "export const a = 1;" + NL,
    mode: "replace",
    form: "here-string",
  });
});

test("Add-Content appends where Set-Content replaces", () => {
  assert.equal(only(cmd("@'", "x", "'@ | Add-Content src/lib/a.mjs")).mode, "append");
  assert.equal(only(cmd("@'", "x", "'@ | Out-File -FilePath src/lib/a.mjs")).mode, "replace");
});

test("a cmdlet with no here-string names the file and admits it cannot read it", () => {
  const t = only("Set-Content -Path src/lib/a.mjs -Value (Get-Date)");
  assert.equal(t.path, "src/lib/a.mjs");
  assert.equal(t.text, null);
});

// --- the file is named, the text is not ---

test("a redirect fed by another program names the file with no text", () => {
  const t = only("printf '%s' 'import x' >> src/lib/a.mjs");
  assert.equal(t.path, "src/lib/a.mjs");
  assert.equal(t.text, null);
  assert.equal(t.mode, "append");
  assert.equal(t.form, "redirect");
});

test("an in-place edit names its file", () => {
  assert.equal(only("sed -i 's/a/b/' src/lib/a.mjs").path, "src/lib/a.mjs");
  assert.equal(only("sed --in-place 's/a/b/' src/lib/a.mjs").text, null);
  assert.equal(only("perl -pi -e 's/a/b/' src/lib/a.mjs").path, "src/lib/a.mjs");
});

test("a copy names its destination and not its source", () => {
  const t = only("cp templates/mod.mjs src/lib/a.mjs");
  assert.equal(t.path, "src/lib/a.mjs");
  assert.equal(t.form, "copy");
  assert.equal(only("mv old.mjs src/lib/a.mjs").path, "src/lib/a.mjs");
});

// --- the declared blind spots, each asserted rather than described ---

test("an unquoted delimiter whose body would be expanded yields no text", () => {
  const t = only(cmd("cat > src/lib/a.mjs <<EOF", `export const home = "${DOLLAR}HOME";`, "EOF"));
  assert.equal(t.path, "src/lib/a.mjs", "the file is still named");
  assert.equal(t.text, null, "the body on the command line is not the body that lands");
});

test("an unquoted delimiter with nothing to expand is still readable", () => {
  assert.equal(only(cmd("cat > src/lib/a.mjs <<EOF", "export const a = 1;", "EOF")).text, "export const a = 1;" + NL);
  assert.equal(only(cmd("cat > a.mjs <<EOF", "a " + BACKSLASH + "n b", "EOF")).text, null);
});

test("a path built at run time is not a path, so nothing is named", () => {
  assert.deepEqual(shellWrites(`cat > "${DOLLAR}out" <<'EOF'` + NL + "x" + NL + "EOF"), []);
  assert.deepEqual(shellWrites("cp a.mjs src/*.mjs"), []);
  assert.deepEqual(shellWrites("cat > src/lib/ <<'EOF'" + NL + "x" + NL + "EOF"), []);
});

test("a program that writes files by itself is invisible", () => {
  for (const command of ["npm run build", "make", "git checkout -- src/lib/a.mjs", "prettier --write src"]) {
    assert.deepEqual(shellWrites(command), [], command);
  }
});

test("the shell's bin is not a file anyone gates", () => {
  assert.deepEqual(shellWrites("node run.mjs > /dev/null"), []);
  assert.deepEqual(shellWrites("node run.mjs > NUL"), []);
});

test("an explicit file descriptor is skipped rather than read as a write", () => {
  assert.deepEqual(shellWrites("node run.mjs 2> errors.log"), []);
  assert.deepEqual(shellWrites("node run.mjs > out.log 2>&1").map((t) => t.path), ["out.log"]);
});

/**
 * The regression that made the tokenizer necessary.
 *
 * Splitting the argument list on whitespace and stopping at the first `;` read
 * the path *inside* the sed script as the file being edited. The gate then
 * judged a file the command never touches, and reported `structure-outside`
 * where the truth was `structure-unreadable` — a wrong answer wearing the shape
 * of a right one, which is the failure this project is about.
 */
test("a separator inside a quoted script does not become the end of the arguments", () => {
  const t = only(`sed -i '1i import { entry } from "../hooks/entry.mjs";' src/lib/seed.mjs`);
  assert.equal(t.path, "src/lib/seed.mjs", "the file the command edits, not the one its script mentions");
  assert.equal(t.text, null);
});

test("a path with whitespace in it is not read, rather than read as two", () => {
  assert.deepEqual(shellWrites(`cp a.mjs "src/lib/my file.mjs"`), []);
  assert.deepEqual(shellWrites(`cat > "src/lib/my file.mjs" <<'EOF'` + NL + "x" + NL + "EOF"), []);
});

test("only the last file of an in-place edit or a copy is named", () => {
  assert.deepEqual(shellWrites("sed -i 's/a/b/' one.mjs two.mjs").map((t) => t.path), ["two.mjs"]);
  assert.deepEqual(shellWrites("cp a.mjs b.mjs dest/").map((t) => t.path), []);
});

test("a cmdlet whose path is not first and not behind -Path is missed, not guessed", () => {
  // Reading `utf8` as a filename is the failure this narrowing exists to avoid.
  assert.deepEqual(shellWrites("Set-Content -Encoding utf8 -Path src/lib/a.mjs -Value x"), []);
});

test("a bare npm install is not a write to its package", () => {
  assert.deepEqual(shellWrites("npm install left-pad right-pad"), []);
  assert.deepEqual(shellWrites("New-Item -ItemType Directory -Force src/lib"), []);
});

// --- the contract itself ---

test("nothing to read produces nothing, on every shape of absent input", () => {
  assert.deepEqual(shellWrites(""), []);
  assert.deepEqual(shellWrites(null), []);
  assert.deepEqual(shellWrites(undefined), []);
  assert.deepEqual(shellWrites(42), []);
});

test("one path is named once, however many shapes claim it", () => {
  const targets = shellWrites(cmd("cat > a.mjs <<'EOF'", "x", "EOF", "sed -i 's/x/y/' a.mjs"));
  assert.equal(targets.length, 1);
  assert.equal(targets[0].text, "x" + NL, "the readable shape wins, not the last one");
});

test("a command line naming hundreds of files is bounded", () => {
  const many = Array.from({ length: 60 }, (_, i) => `echo x > f${i}.mjs`).join(NL);
  assert.equal(shellWrites(many).length, 20);
});
