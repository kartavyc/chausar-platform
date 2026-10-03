# Local fonts

Eight static, normal-width WOFF2 faces from the four specified families total **300,672 bytes**, below the exclusive 600,000-byte budget. All source glyphs are retained. The four adjacent OFL notices are complete, unchanged publisher files. Exact immutable sources, hashes, measured sizes and operations are recorded in `manifest.json`.

Instrument Sans 400/500/600 and IBM Plex Mono 500 are byte-identical publisher WOFF2 files with app filenames. IBM's reserved Plex name is preserved without modifying its font. DM Mono 400/500 are full TTF-to-WOFF2 conversions. Noto Sans Devanagari 400/500 are full-source instances at `wdth=100`, then WOFF2 conversions. No source glyphs were removed to meet the budget.

FontTools 4.66.1, Brotli 1.2.0 and uharfbuzz 0.56.2/HarfBuzz 14.5.0 ran offline against hash-verified acquired inputs. The normal weights, width, static status, full cmap mappings and glyph order pass. DM Mono retains a 600-font-unit advance for each decimal digit.

The full catalogue corpus includes 462 English/Hindi message pairs, all ICU branch samples, the 123-screen catalogue, enterprise and CA surfaces, and provisional Hindi transcription from the authoritative raster reference. All 448 distinct Hindi strings match source-variable shaping at both target weights. The complete corpus run passes 3,267 exact glyph/cluster/advance/offset comparisons; the independent run passes 3,485 comparisons and 292,654 Noto pair-position checks, with no tolerance or mismatches. Static instancing canonicalizes two Noto GPOS subtables while preserving their effective positioning.

Instrument Sans and DM Mono do not contain the rupee sign. The local stacks therefore keep their original primary faces, then use Noto for Hindi and rupee, Instrument for arrows, and DM for uncommon Latin-1 symbols. The IBM face serves only `chausar`. Declared corpus glyphs are covered by these shipped stacks; scripts beyond this Latin/Devanagari pack still use the existing OS fallback.

These are offline font-data and shaping checks. Actual browser/host loading and fallback runs, reference pixels, Hindi wrapping/clipping and native reading, rendered word/button budgets and accessibility remain separate acceptance gates. Parent owns C8 guard reconciliation and activation.

The source CSS uses Vite's `?no-inline` directive and the validation config uses a relative base. The library build emits all eight WOFF2 files separately with relative CSS URLs, so it can follow `font-src 'self'` without data-font URLs. Host packaging must copy those files, CSS/JS and these notices/provenance into its reviewed asset allowlist.
