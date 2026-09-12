import { readFileSync } from "node:fs";
import { parse } from "yaml";

export function readYaml(path: string): unknown {
  return parse(readFileSync(path, "utf8"));
}
