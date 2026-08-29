import refractor from 'refractor/core';
import bash from 'refractor/lang/bash';
import c from 'refractor/lang/c';
import cpp from 'refractor/lang/cpp';
import csharp from 'refractor/lang/csharp';
import docker from 'refractor/lang/docker';
import go from 'refractor/lang/go';
import graphql from 'refractor/lang/graphql';
import ini from 'refractor/lang/ini';
import java from 'refractor/lang/java';
import json from 'refractor/lang/json';
import jsx from 'refractor/lang/jsx';
import kotlin from 'refractor/lang/kotlin';
import less from 'refractor/lang/less';
import lua from 'refractor/lang/lua';
import markdown from 'refractor/lang/markdown';
import php from 'refractor/lang/php';
import python from 'refractor/lang/python';
import ruby from 'refractor/lang/ruby';
import rust from 'refractor/lang/rust';
import scss from 'refractor/lang/scss';
import sql from 'refractor/lang/sql';
import swift from 'refractor/lang/swift';
import toml from 'refractor/lang/toml';
import tsx from 'refractor/lang/tsx';
import typescript from 'refractor/lang/typescript';
import yaml from 'refractor/lang/yaml';

/**
 * `refractor/core` arrives with markup, css, clike and javascript already
 * registered; everything else is opt-in. The package root would register all 277
 * grammars, which is most of a megabyte for languages this app never diffs.
 *
 * Each grammar module registers its own dependencies, so import order does not
 *  matter; `diff-language.test.ts` proves every entry here resolves.
 */
const GRAMMARS = [
  bash,
  c,
  cpp,
  csharp,
  docker,
  go,
  graphql,
  ini,
  java,
  json,
  jsx,
  kotlin,
  less,
  lua,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  toml,
  tsx,
  typescript,
  yaml,
];

for (const grammar of GRAMMARS) {
  refractor.register(grammar);
}

/**
 * react-diff-view's `tokenize` types its `refractor` option against refractor
 * v4's named `highlight` export; we are on v3, whose default export carries the
 * same `highlight(value, language)` call. The shapes agree at the only point
 * `tokenize` touches.
 */
export const highlighter = refractor as unknown as {
  highlight: (value: string, name: string) => unknown;
};

export function isLanguageSupported(name: string): boolean {
  return refractor.registered(name);
}
