// Downloads the evaluation datasets into eval/sms/.data/. Plain Node ESM, no dependencies.
// Downloads are treated as data only: they are written to disk and parsed as JSON, never executed.
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".data");
mkdirSync(dir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with polite retry: honours Retry-After on 429/5xx, otherwise exponential backoff. */
async function politeFetch(url, tries = 8) {
  let wait = 2000;
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetch(url, { headers: { "user-agent": "sms-eval-fetch" } });
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(wait);
      wait = Math.min(wait * 2, 60000);
      continue;
    }
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after"));
      const ms = Number.isFinite(ra) && ra > 0 ? ra * 1000 : wait;
      console.log(`  ${res.status} from server, waiting ${Math.round(ms / 1000)}s`);
      await sleep(ms);
      wait = Math.min(wait * 2, 60000);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  throw new Error(`gave up on ${url}`);
}

async function download(url, file) {
  if (existsSync(file) && statSync(file).size > 0) return console.log(`have ${path.basename(file)}`);
  console.log(`downloading ${path.basename(file)} ...`);
  const res = await politeFetch(url);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, file);
  console.log(`  ${(statSync(file).size / 1e6).toFixed(1)} MB`);
}

for (const split of ["test", "valid", "train"]) {
  await download(`https://huggingface.co/datasets/Ranjit0034/finee-dataset/resolve/main/data/${split}.jsonl`, path.join(dir, `${split}.jsonl`));
}

const spamFile = path.join(dir, "spam.json");
if (existsSync(spamFile) && statSync(spamFile).size > 0) {
  console.log("have spam.json");
} else {
  console.log("paging CloveAI/india-spam-sms ...");
  const rows = [];
  const base = "https://datasets-server.huggingface.co/rows?dataset=CloveAI/india-spam-sms&config=default&split=train";
  let total = Infinity;
  for (let offset = 0; offset < total; offset += 100) {
    const body = await (await politeFetch(`${base}&offset=${offset}&length=100`)).json();
    total = body.num_rows_total ?? total;
    for (const r of body.rows ?? []) rows.push({ text: String(r.row.text ?? r.row.sms ?? r.row.message ?? ""), label: Number(r.row.label) });
    if (offset % 2000 === 0) console.log(`  ${rows.length}/${total}`);
    await sleep(150);
  }
  writeFileSync(spamFile, JSON.stringify(rows));
  console.log(`  ${rows.length} rows`);
}
