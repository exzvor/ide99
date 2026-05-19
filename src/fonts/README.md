# Bundled web fonts

Self-hosted WOFF2 files referenced by `src/styles/tokens.css` `@font-face`
declarations. Bundling the fonts (rather than fetching from a CDN) keeps
ide99 working fully offline and removes a third-party network dependency.

The files included here are the **full** (unsubsetted) WOFF2 builds shipped
by the upstream projects. They contain Latin + Cyrillic + the rest of each
font's coverage. Subsetting to Latin + Cyrillic only is tracked for S35
(see roadmap) — the ~750 KB current bundle is acceptable for S1.

## Sources

| Family / weight              | Filename                           | Upstream artifact                                                                                       | Source path inside zip       |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Inter Regular (400)          | `Inter-Regular.woff2`              | [`Inter-4.1.zip`](https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip)                   | `web/Inter-Regular.woff2`    |
| Inter Medium (500)           | `Inter-Medium.woff2`               | (same as above)                                                                                         | `web/Inter-Medium.woff2`     |
| Inter SemiBold (600)         | `Inter-SemiBold.woff2`             | (same as above)                                                                                         | `web/Inter-SemiBold.woff2`   |
| Inter Bold (700)             | `Inter-Bold.woff2`                 | (same as above)                                                                                         | `web/Inter-Bold.woff2`       |
| Inter Display Bold (700)     | `InterDisplay-Bold.woff2`          | (same as above)                                                                                         | `web/InterDisplay-Bold.woff2` |
| JetBrains Mono Regular (400) | `JetBrainsMono-Regular.woff2`      | [`JetBrainsMono-2.304.zip`](https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip) | `fonts/webfonts/JetBrainsMono-Regular.woff2` |
| JetBrains Mono Medium (500)  | `JetBrainsMono-Medium.woff2`       | (same as above)                                                                                         | `fonts/webfonts/JetBrainsMono-Medium.woff2`  |

> Note on Inter Display: the spec referenced `Inter-DisplayBold.woff2`, but
> the v4.1 release ships the file as `InterDisplay-Bold.woff2` (hyphenated).
> The on-disk filename and the `@font-face` `src:` URL both use the actual
> upstream name.

## Verification

Sizes (from `du -k`) and SHA-256 (from `shasum -a 256`) at the time of
import. Re-run `shasum -a 256 src/fonts/*.woff2` to confirm integrity.

| File                              | Size (KB) | SHA-256                                                            |
| --------------------------------- | --------: | ------------------------------------------------------------------ |
| `Inter-Regular.woff2`             |       112 | `e06f6b1bc553aaea4e4668023ed0ab0a147129c3107f511bc7d03d361b0ae085` |
| `Inter-Medium.woff2`              |       112 | `0ff3e94614e1493eb556314fd247ae6c4a85a7783b4cc86be539940cf83f2a48` |
| `Inter-SemiBold.woff2`            |       116 | `5cb7103e4e605989afebc03d989c79201e54b21b5183db33981f70db9178a301` |
| `Inter-Bold.woff2`                |       116 | `fa888127b6da015b65569f0351f3b5c391ad928904951f1c20e9f8462a8d95ea` |
| `InterDisplay-Bold.woff2`         |       112 | `23bc37619593377e128f24660fedb2869d18277b4026cb46e5637be7643faf91` |
| `JetBrainsMono-Regular.woff2`     |        92 | `a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2` |
| `JetBrainsMono-Medium.woff2`      |        92 | `086c48dfbea9ddaff1320f7e09399b8e2924e88ce67453721255db3bdbb5a353` |

Total bundle (`du -ch *.woff2 | tail -1`): **~752 KB**.

## Reproduce

```bash
cd /tmp && rm -rf ide99-fonts && mkdir ide99-fonts && cd ide99-fonts
curl -L -o Inter-4.1.zip \
  https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
curl -L -o JetBrainsMono-2.304.zip \
  https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip
mkdir inter jbm
unzip -q Inter-4.1.zip -d inter
unzip -q JetBrainsMono-2.304.zip -d jbm
cp inter/web/Inter-Regular.woff2 \
   inter/web/Inter-Medium.woff2 \
   inter/web/Inter-SemiBold.woff2 \
   inter/web/Inter-Bold.woff2 \
   inter/web/InterDisplay-Bold.woff2 \
   <repo>/src/fonts/
cp jbm/fonts/webfonts/JetBrainsMono-Regular.woff2 \
   jbm/fonts/webfonts/JetBrainsMono-Medium.woff2 \
   <repo>/src/fonts/
shasum -a 256 <repo>/src/fonts/*.woff2  # compare with table above
```

## Licensing

- **Inter**: SIL Open Font License 1.1 — see `inter/LICENSE.txt` in the
  release zip. Author: Rasmus Andersson (https://rsms.me/inter/).
- **JetBrains Mono**: SIL Open Font License 1.1 — see
  `jbm/OFL.txt` in the release zip. Author: JetBrains s.r.o.

Both licenses permit redistribution as part of bundled software.
