#!/usr/bin/env bash
# Advisories des fertigen Edge-Images (core#448, ADR 0051 Punkt 8).
#
# Zwei Scans, weil keiner allein beide Paketwelten richtig sieht (gemessen
# 2026-10-01 an v26.9.16 und v26.10.1, osv-scanner 2.6.0):
#   npm    — aus der Stueckliste (`scan --sbom`). Der Image-Scan sieht die
#            node_modules des Images nicht: An v26.9.16 meldete er 0 npm-Befunde,
#            die Stueckliste die neun Pakete des npm-CLI aus core#446.
#   Debian — aus dem Image (`scan image`). Der Stuecklisten-Scan kennt das
#            Debian-Release nicht und ordnet Binaer- nicht Quellpaketen zu
#            (glibc, krb5, openldap fehlten ganz).
#
# Regel (Entscheidung Michael 2026-10-01):
#   - jeder npm-Befund → rot (bewusste Ausnahmen in osv-scanner.toml)
#   - Debian → immer Bericht, rot nur, wenn bookworm einen Fix hat, der neuer
#     ist als das installierte Paket. Ohne Fix haengt sonst jedes Release an
#     Debian fest (v26.10.1: 157 Befunde, 155 ohne Fix).
#
# Aufruf: osv-edge-advisories.sh --sbom <cdx.json> (--image <ref> | --archive <tar>)
#                                [--config <osv-scanner.toml>] [--osv <binary>]
# Bericht als Markdown auf stdout. Exit 0 = gruen, 1 = Befund nach Regel,
# 2 = Scan nicht gelaufen oder Ergebnis unplausibel (fail-closed: ein Fehler ist
# nie gruen; auch ein abbrechendes jq endet ueber den ERR-Trap auf 2).
set -euo pipefail
trap 'exit 2' ERR

sbom='' image='' archive='' config='' osv='osv-scanner'
while [ $# -gt 0 ]; do
  case "$1" in
    --sbom) sbom="$2"; shift 2 ;;
    --image) image="$2"; shift 2 ;;
    --archive) archive="$2"; shift 2 ;;
    --config) config="$2"; shift 2 ;;
    --osv) osv="$2"; shift 2 ;;
    *) echo "unbekannte Option: $1" >&2; exit 2 ;;
  esac
done
if [ -z "$sbom" ] || [ ! -f "$sbom" ]; then echo "::error::--sbom fehlt oder existiert nicht: ${sbom}" >&2; exit 2; fi
[ -n "$image" ] || [ -n "$archive" ] || { echo "::error::--image oder --archive fehlt" >&2; exit 2; }
command -v dpkg >/dev/null || { echo "::error::dpkg fehlt — ohne dpkg --compare-versions ist 'Fix vorhanden' nicht bestimmbar" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cfg=()
[ -n "$config" ] && cfg=(--config "$config")

# osv-scanner: 0 = nichts gefunden, 1 = Befunde. Alles andere ist ein Fehler.
run_osv() {
  local out="$1"; shift
  local rc=0
  "$osv" "$@" ${cfg[@]+"${cfg[@]}"} --format json --output-file "$out" 2>"$out.err" || rc=$?
  if [ "$rc" -gt 1 ]; then
    echo "::error::osv-scanner $1 brach mit Exit ${rc} ab:" >&2
    tail -5 "$out.err" >&2
    exit 2
  fi
  [ -s "$out" ] || { echo "::error::osv-scanner $1 schrieb kein Ergebnis" >&2; exit 2; }
}

# --- npm aus der Stueckliste -------------------------------------------------
# Nur pkg:npm mit Version. syft fuehrt verschachtelte package.json ohne
# Versionsfeld (z.B. engine.io-client/build/cjs/package.json, nur ein
# Modul-Marker) als eigene Komponente; osv-scanner nimmt sie als UNKNOWN und
# meldet dann jedes Advisory des Pakets.
jq '.components |= map(select((.purl // "") | test("^pkg:npm/.+@[^@/]+$")))
    | del(.dependencies)' "$sbom" > "$work/npm.cdx.json"
npm_total=$(jq '.components | length' "$work/npm.cdx.json")
npm_noversion=$(jq '[.components[] | select((.purl // "") | test("^pkg:npm/") and (test("^pkg:npm/.+@[^@/]+$") | not))] | length' "$sbom")
[ "$npm_total" -gt 0 ] || { echo "::error::Stueckliste ohne versionierte npm-Komponenten" >&2; exit 2; }
run_osv "$work/npm.json" scan --sbom "$work/npm.cdx.json"

# "Fix ab" = kleinster Fix-Stand oberhalb der installierten Version; die Advisories
# fuehren die Fix-Staende aller Versionslinien (brace-expansion: 27 Stueck).
jq -r 'def semver: [scan("[0-9]+") | tonumber][0:3];
       [.results[]?.packages[]? | select(.package.ecosystem == "npm")
        | .package as $p
        | {n: $p.name, v: $p.version,
           ids: ([.groups[]?.ids[0]] | join(", ")),
           fix: ([.vulnerabilities[].affected[]? | select(.package.name == $p.name)
                  | .ranges[]?.events[]?.fixed // empty]
                 | unique | map(select(semver > ($p.version | semver)))
                 | sort_by(semver) | first // "–")}]
       | unique_by(.n + "@" + .v)' "$work/npm.json" > "$work/npm-rows.json"
npm_hits=$(jq 'length' "$work/npm-rows.json")
# Ein Ergebnis ohne jedes gescannte Paket heisst: osv-scanner hat die Datei nicht
# verstanden, nicht "keine Befunde". Ohne Befunde fehlt .results ganz, deshalb
# zaehlt hier die Fehlerausgabe ("found N packages").
npm_scanned=$(grep -oE 'found [0-9]+ packages' "$work/npm.json.err" | grep -oE '[0-9]+' | head -1 || true)
if [ -z "$npm_scanned" ] || [ "$npm_scanned" -eq 0 ]; then
  echo "::error::osv-scanner hat in der npm-Stueckliste keine Pakete erkannt (${npm_total} uebergeben)" >&2; exit 2
fi

# --- Debian aus dem Image ----------------------------------------------------
if [ -n "$archive" ]; then
  run_osv "$work/img.json" scan image --archive "$archive"
else
  run_osv "$work/img.json" scan image "$image"
fi
os=$(jq -r '.image_metadata.os // "unbekannt"' "$work/img.json")
# Ohne erkanntes Debian-Release faellt jeder Debian-Befund aus dem Filter unten
# heraus, und der Bericht zeigte still 0. Genau das ist dem Stuecklisten-Scan
# passiert ("Debian" statt "Debian:12") — hier ist es ein Abbruch, kein Gruen.
case "$os" in
  *Debian*) ;;
  *) echo "::error::Image-Scan erkennt kein Debian-Release (os: ${os}) — Debian-Regel nicht auswertbar" >&2; exit 2 ;;
esac

# Je (Paket, Advisory) die Fix-Staende des eigenen Releases. Das Release kommt
# aus dem Ergebnis selbst (Debian:12), nicht aus einer Annahme.
jq -r '.results[]?.packages[]? | select(.package.ecosystem | startswith("Debian:"))
       | .package as $p | .vulnerabilities[]
       | [$p.name, $p.version, .id,
          ([.affected[]? | select(.package.ecosystem == $p.ecosystem and .package.name == $p.name)
            | .ranges[]?.events[]?.fixed // empty] | unique | join(" "))]
       | @tsv' "$work/img.json" | sort -u > "$work/deb.tsv"

: > "$work/deb-fix.tsv"
while IFS=$'\t' read -r name version id fixes; do
  for f in $fixes; do
    # dpkg: 0 = kleiner, 1 = nicht kleiner, sonst unlesbare Version → Abbruch statt "kein Fix"
    rc=0; dpkg --compare-versions "$version" lt "$f" || rc=$?
    if [ "$rc" -gt 1 ]; then
      echo "::error::dpkg kann ${name} ${version} nicht mit ${f} vergleichen (Exit ${rc})" >&2; exit 2
    fi
    if [ "$rc" -eq 0 ]; then
      printf '%s\t%s\t%s\t%s\n' "$name" "$version" "$id" "$f" >> "$work/deb-fix.tsv"
      break
    fi
  done
done < "$work/deb.tsv"
deb_hits=$(wc -l < "$work/deb.tsv" | tr -d ' ')
deb_pkgs=$(cut -f1,2 "$work/deb.tsv" | sort -u | wc -l | tr -d ' ')
deb_fix=$(wc -l < "$work/deb-fix.tsv" | tr -d ' ')

# --- Bericht -----------------------------------------------------------------
rot() { [ "$1" -gt 0 ] && echo '🔴' || echo '🟢'; }
echo "### Advisories ($(basename "$sbom"))"
echo
echo "| Quelle | gescannt | Befunde | Regel |"
echo "|---|---|---|---|"
echo "| npm (Stueckliste) | ${npm_total} Pakete | ${npm_hits} Pakete | $(rot "$npm_hits") jeder Befund rot |"
echo "| Debian (Image, ${os}) | — | ${deb_hits} in ${deb_pkgs} Paketen, davon ${deb_fix} mit Fix | $(rot "$deb_fix") rot nur mit Fix |"
echo
[ "$npm_noversion" -gt 0 ] && echo "_${npm_noversion} npm-Komponenten ohne Version nicht gescannt (verschachtelte package.json)._" && echo
if [ "$npm_hits" -gt 0 ]; then
  echo "#### npm"
  echo "| Paket | Version | Advisories | Fix ab |"
  echo "|---|---|---|---|"
  jq -r '.[] | "| \(.n) | \(.v) | \(.ids) | \(.fix) |"' "$work/npm-rows.json"
  echo
fi
if [ "$deb_fix" -gt 0 ]; then
  echo "#### Debian mit Fix im Release"
  echo "| Paket | installiert | Advisory | Fix |"
  echo "|---|---|---|---|"
  awk -F'\t' '{printf "| %s | %s | %s | %s |\n", $1, $2, $3, $4}' "$work/deb-fix.tsv"
  echo
fi
if [ "$deb_hits" -gt 0 ]; then
  echo "<details><summary>Debian: alle ${deb_hits} Befunde</summary>"
  echo
  echo "| Paket | installiert | Advisory |"
  echo "|---|---|---|"
  awk -F'\t' '{printf "| %s | %s | %s |\n", $1, $2, $3}' "$work/deb.tsv"
  echo
  echo "</details>"
fi

if [ "$npm_hits" -gt 0 ]; then
  echo "::error::${npm_hits} npm-Pakete im Edge-Image mit bekanntem Advisory — Override/Bump oder begruendete Ausnahme in osv-scanner.toml" >&2
fi
if [ "$deb_fix" -gt 0 ]; then
  echo "::error::${deb_fix} Debian-Advisories mit Fix im Release, das Image fuehrt die alte Version — Base-Image neu ziehen bzw. apt-Upgrade im Runtime-Stage" >&2
fi
[ "$npm_hits" -eq 0 ] && [ "$deb_fix" -eq 0 ] || exit 1
