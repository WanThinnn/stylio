import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const entry=new URL('../../web/styles.css',import.meta.url);
const css=readFileSync(entry,'utf8');
const paths=[...css.matchAll(/@import url\("([^"]+)"\);/g)].map(match=>match[1]);
const worker=readFileSync(new URL('../../web/sw.js',import.meta.url),'utf8');
test('flat CSS entry is small, ordered, locally resolvable and available on cold offline boot',()=>{
  assert.equal(paths.length,11);assert.ok(css.split('\n').length<15);
  assert.match(paths[0],/foundations\/tokens/);assert.match(paths[1],/foundations\/base/);
  const boot=worker.match(/const BOOT_SHELL=(.*);/)[1];
  for(const path of paths){
    const imported=readFileSync(new URL(path,entry),'utf8');
    assert.doesNotMatch(imported,/@import/,'no extra import waterfall');
    assert.ok(boot.includes(path),'cold shell must cache '+path);
  }
});
test('preview styles preserve full image geometry, and shell uses safe areas and reduced motion',()=>{
  const all=paths.map(path=>readFileSync(new URL(path,entry),'utf8')).join('\n');
  assert.match(all,/safe-area-inset-top/);assert.match(all,/safe-area-inset-bottom/);
  assert.match(all,/prefers-reduced-motion/);
  assert.doesNotMatch(all,/ai-ring-spin|target-bounce/);
  assert.doesNotMatch(all,/\.ai-preview\s*\{[^}]*object-fit:\s*cover/);
  assert.doesNotMatch(all,/\.ai-preview\s*\{[^}]*filter:/);
});

test('four-tab floating dock has a separate search action and material fallbacks',()=>{
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const material=readFileSync(new URL('../../web/styles/components/materials.css',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  const dock=layout.match(/\.app-dock \{([^}]+)\}/)[1];
  assert.match(dock,/position: relative/);
  assert.doesNotMatch(dock,/100[sd l]*vh|top:|bottom:|translate/);
  assert.match(layout,/\.app-chrome \{[^}]*position: fixed;[^}]*inset: 0;[^}]*align-items: flex-end;[^}]*pointer-events: none/s);
  assert.match(dock,/pointer-events: auto/);
  assert.ok(html.indexOf('</main>')<html.indexOf('id="app-chrome"'),'navigation must live outside content and its transforms');
  assert.match(layout,/min-height: var\(--tab-height\)/);
  assert.match(layout,/\.app-tabs button \{[^}]*color: var\(--nav-idle\)/s);
  assert.match(material,/prefers-reduced-transparency:reduce/);assert.match(material,/prefers-contrast:more/);
  assert.match(material,/prefers-reduced-motion:reduce/);assert.match(material,/forced-colors:active/);
  assert.equal([...html.matchAll(/data-screen="/g)].length,4);
  assert.match(html,/id="settings-screen" class="app-screen/);
  assert.doesNotMatch(html,/<dialog id="app-settings"/);
  assert.match(html,/id="history-search" type="search"/);
  assert.match(material,/inset 0 1px 2px/);
});
test('AI summary keeps the switch beside its label while pinning Settings to the trailing edge',()=>{
  const workspace=readFileSync(new URL('../../web/styles/layout/workspace.css',import.meta.url),'utf8');
  const controls=readFileSync(new URL('../../web/styles/components/controls.css',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  assert.match(workspace,/\.depth-options>\.ai-summary \{[^}]*display: flex;[^}]*gap: 10px/s);
  assert.match(workspace,/\.depth-options>\.ai-summary>\.ai-settings-trigger \{[^}]*margin-left: auto/s);
  assert.doesNotMatch(workspace,/\.ai-settings-trigger \{[^}]*position: absolute/);
  assert.match(workspace,/ai-settings-discovery-nudge/);
  assert.match(html,/id="enhance-ai"[^>]*>[\s\S]*?id="ai-settings-discovery"[\s\S]*?id="open-ai-settings"/);
  assert.match(workspace,/\.depth-options>\.ai-summary>\.ai-settings-discovery:not\(\[hidden\]\)\+\.ai-settings-trigger \{[^}]*margin-left: 0/s);
  assert.doesNotMatch(workspace,/ai-settings-discovery:not\(\[hidden\]\)[^}]*outline: 1px solid var\(--ai-violet\)/s);
  assert.match(controls,/grid-template-columns: 36px minmax\(82px,\.75fr\) minmax\(150px,1\.35fr\)/);
  assert.doesNotMatch(controls,/@container \(max-width: 22rem\)/);
});

test('Apple system blue drives app accents and scrollbar hiding does not disable normal scrolling',()=>{
  const tokens=readFileSync(new URL('../../web/styles/foundations/tokens.css',import.meta.url),'utf8');
  const base=readFileSync(new URL('../../web/styles/foundations/base.css',import.meta.url),'utf8');
  assert.match(tokens,/--blue-600: #007aff/);
  assert.match(tokens,/--accent-text: #007aff/);
  assert.match(tokens,/@media\(prefers-color-scheme:dark\)[\s\S]*?--blue-600: #0a84ff;[\s\S]*?--accent-text: #0a84ff/s);
  assert.match(tokens,/:root\[data-theme="dark"\][\s\S]*?--blue-600: #0a84ff;[\s\S]*?--accent-text: #0a84ff/s);
  assert.match(tokens,/--on-accent: #fff/);
  assert.match(base,/scrollbar-width: none/);assert.match(base,/\*::-webkit-scrollbar \{[^}]*display: none/);
  assert.match(base,/html \{[^}]*touch-action: pan-x pan-y/s);
  assert.match(base,/body \{[^}]*touch-action: pan-x pan-y/s);
  assert.doesNotMatch(base,/(?:^|\n)(?:html|body|\*) \{[^}]*overflow: hidden/);
});

test('PWA locks page zoom while keeping native one-finger scrolling',()=>{
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../../web/src/ui/page-bootstrap.js',import.meta.url),'utf8');
  const nav=readFileSync(new URL('../../web/styles/components/navigation-effects.css',import.meta.url),'utf8');
  assert.match(html,/name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/);
  assert.match(bootstrap,/\['gesturestart','gesturechange','gestureend'\]/);
  assert.match(bootstrap,/preventDefault\(\)/);
  assert.match(nav,/\.app-tabs \{[^}]*touch-action: pan-y/s);
  assert.doesNotMatch(nav,/touch-action: pan-y pinch-zoom/);
});


test('shell keeps the intro visible and aligns viewport chrome at the safe bottom',()=>{
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  const i18n=readFileSync(new URL('../../web/src/ui/i18n.js',import.meta.url),'utf8');
  assert.doesNotMatch(layout,/\.has-used-app \.intro/);
  assert.match(layout,/\.intro \{[^}]*text-align: center/s);
  assert.match(layout,/\.app-chrome \{[^}]*padding-bottom: calc\(var\(--dock-keyboard-offset,0px\) \+ max\(10px,calc\(env\(safe-area-inset-bottom,0px\) - 12px\)\)\)/s);
  assert.match(i18n,/Portrait Lighting, Styles, Texture and Grain\.<br>Privately, on your device\./);
  assert.match(html,/class="icon-button glass-surface" id="close-photo"[^>]*><svg/);
});

test('portrait aperture keeps the yellow selector centered while the ruler moves and preserves the initial aperture dot',()=>{
  const css=readFileSync(new URL('../../web/styles/components/portrait-editor.css',import.meta.url),'utf8');
  const js=readFileSync(new URL('../../web/src/portrait/ai-portrait-preview.js',import.meta.url),'utf8');
  assert.match(css,/\.ai-aperture-selection \{[^}]*left: 50%/s);
  assert.match(css,/\.ai-aperture-origin \{/);
  assert.match(js,/className='ai-aperture-origin'/);
  assert.match(js,/ruler\.style\.transform=.*-index\*TICK_SPACING/);
  assert.match(css,/\.ai-aperture-track \{[^}]*touch-action: pan-y/s);
  assert.match(js,/track\.addEventListener\('pointermove'/);
  assert.match(js,/drag\.startIndex-dx\/TICK_SPACING/);
  assert.doesNotMatch(js,/selection\.style\.left/);
});

test('process header and Smart Enhance controls use a tighter native grouping',()=>{
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const workspace=readFileSync(new URL('../../web/styles/layout/workspace.css',import.meta.url),'utf8');
  assert.match(layout,/\.app-logo \{[^}]*width: 40px;[^}]*height: 40px/s);
  assert.match(layout,/h1 \{[^}]*font-size: 1\.375rem;[^}]*font-weight: 700/s);
  assert.match(layout,/@media\(max-width:767px\)[\s\S]*?h1 \{[^}]*font-size: 1\.375rem;[^}]*font-weight: 720/s);
  assert.match(layout,/@media\(max-width:767px\)[\s\S]*?\.top \{[^}]*position: fixed;[^}]*top: 0;[^}]*width: 100%;[^}]*background: var\(--bg\)/s);
  assert.match(layout,/@media\(max-width:767px\)[\s\S]*?main \{[^}]*padding-top: calc\(env\(safe-area-inset-top,0px\) \+ 92px\)/s);
  assert.match(workspace,/\.depth-options>\.ai-summary \{[^}]*display: flex;[^}]*align-items: center/s);
  assert.match(workspace,/\.depth-options>\.ai-summary>\.ai-settings-trigger \{[^}]*margin-left: auto/s);
});

test('Portrait preview uses an Apple-like control strip with Photos info, toggle and reset',()=>{
  const css=readFileSync(new URL('../../web/styles/components/portrait-editor.css',import.meta.url),'utf8');
  const js=readFileSync(new URL('../../web/src/portrait/ai-portrait-preview.js',import.meta.url),'utf8');
  const strings=readFileSync(new URL('../../web/src/ui/ai-strings.js',import.meta.url),'utf8');
  assert.match(css,/\.ai-preview-toolbar \{[^}]*grid-template-columns: 1fr auto 1fr/s);
  assert.match(css,/\.ai-mode-f \{[^}]*width: 24px;[^}]*height: 24px;[^}]*border: 1\.15px solid currentColor;[^}]*border-radius: 50%;[^}]*font-family: -apple-system/s);
  assert.match(css,/\.ai-photo-mode\[aria-pressed="true"\] \{[^}]*color: #c08b00/s);
  assert.doesNotMatch(css,/\.ai-photo-mode\[aria-pressed="true"\] \{[^}]*background:/s);
  assert.match(css,/\.ai-preview-actions \{[^}]*justify-self: end;[^}]*gap: 0;[^}]*border-radius: var\(--capsule-radius\);[^}]*background: rgb\(var\(--glass-rgb\) \/ \.52\)/s);
  assert.match(css,/\.ai-portrait-toggle \{[^}]*border-radius: var\(--capsule-radius\);[^}]*background: linear-gradient\(180deg,#ffdf62/s);
  assert.match(css,/\.ai-portrait-toggle\[aria-pressed="false"\] \{[^}]*color: var\(--muted\)/s);
  assert.match(css,/\.result-details \+ \.ai-details \{[^}]*margin-top: -8px/s);
  assert.match(js,/className='ai-photos-controls'/);
  assert.match(js,/className='ai-photo-mode'/);
  assert.match(js,/className='ai-center-focus'/);
  assert.match(js,/className='ai-preview-actions'/);
  assert.match(js,/className='ai-portrait-toggle'/);
  assert.match(js,/class="ai-lighting-symbol"/);
  assert.match(js,/photos\.append\(lightingMode,apertureMode\)/);
  assert.doesNotMatch(css,/\.ai-center-focus::after/);
  assert.doesNotMatch(js,/className='ai-spinner'/);
  assert.match(js,/portraitToggle\.setAttribute\('aria-pressed',String\(enabled\)\)/);
  assert.match(js,/photosInfo\.hidden=!lighting/);
  assert.match(js,/blur\.disabled=!enabled/);
  assert.match(strings,/"photosEdit": "Aperture and lighting"/);
  assert.match(strings,/"lighting": "Portrait Lighting"/);
  assert.match(strings,/"centreFocus": "Centre focus"/);
  assert.match(strings,/"photosEditHint": "After saving, open the photo in Photos/);
});

test('AI Settings preserves the original wide inline Model control on narrow sheets',()=>{
  const controls=readFileSync(new URL('../../web/styles/components/controls.css',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  const strings=readFileSync(new URL('../../web/src/ui/ai-strings.js',import.meta.url),'utf8');
  const sheets=readFileSync(new URL('../../web/styles/components/sheets.css',import.meta.url),'utf8');
  assert.match(controls,/\.depth-model-row \{[^}]*grid-template-columns: 36px minmax\(82px,\.75fr\) minmax\(150px,1\.35fr\)/s);
  assert.match(sheets,/\.ai-options-group>\.portrait-option\.depth-model-row \{[^}]*grid-template-columns: 36px minmax\(108px,\.9fr\) minmax\(140px,1\.1fr\)/s);
  assert.match(sheets,/\.ai-options-group>\.portrait-option\.depth-model-row>\.ai-option-icon \{[^}]*align-self: center;[^}]*justify-self: center/s);
  assert.match(sheets,/\.ai-options-group>\.portrait-option\.depth-model-row>\.ai-option-copy \{[^}]*padding-left: 7px;[^}]*box-sizing: border-box/s);
  assert.match(sheets,/\.ai-options-group>\.portrait-option\.depth-model-row>\.ai-option-copy \.ai-hint \{[^}]*text-wrap: balance/s);
  assert.match(sheets,/@container \(max-width:22rem\)[\s\S]*?\.depth-model-control \{[^}]*grid-column: 3;[^}]*grid-row: 1;[^}]*min-width: 128px/s);
  assert.match(html,/class="ai-model-network-symbol" viewBox="0 0 28 28"/);
  assert.match(controls,/\.ai-model-network-symbol \{[^}]*width: 25px;[^}]*height: 25px/s);
  assert.match(strings,/"modelHint": "Lite is faster\. Pro gives finer AI results\."/);
});

test('settings follows iOS grouped rows with language navigation, appearance preview and GitHub toolbar action',()=>{
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  const sheets=readFileSync(new URL('../../web/styles/components/sheets.css',import.meta.url),'utf8');
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../../web/src/ui/page-bootstrap.js',import.meta.url),'utf8');
  assert.match(html,/class="top-github-symbol"/);
  assert.doesNotMatch(html,/class="settings-github icon-button glass-surface"/);
  assert.match(html,/class="settings-nav-row language-row"/);
  assert.match(html,/class="settings-leading-icon settings-icon-blue"/);
  assert.doesNotMatch(sheets,/\.language-row \.settings-leading-icon \{/);
  assert.match(html,/class="settings-leading-icon settings-icon-appearance"/);
  assert.match(sheets,/\.settings-icon-appearance \{[^}]*background: var\(--appearance-icon-bg\)/s);
  assert.match(html,/class="appearance-segment"/);
  assert.match(html,/settings\.defaultsave/);
  assert.match(html,/settings\.keepscreen/);
  assert.match(html,/id="result-preview"/);
  assert.match(html,/settings\.resultpreviewhint/);
  assert.match(html,/settings\.originalformat/);
  assert.equal([...html.matchAll(/class="ai-option-icon /g)].length,5);
  assert.match(html,/settings-icon-github/);
  assert.match(html,/class="ai-depth-focus-symbol"/);
  assert.match(sheets,/\.settings-about \.settings-nav-row:has\(\.settings-leading-icon\) \.settings-chevron \{[^}]*grid-column: 4/s);
  assert.match(sheets,/\.settings-chevron \{[^}]*justify-self: end/s);
  assert.match(sheets,/\.language-row #lang \{[^}]*appearance: none/s);
  assert.match(sheets,/\.settings-leading-icon/);
  assert.match(layout,/\.top-github-symbol \{[^}]*translateY\(-22px\)/s);
  assert.match(layout,/body\.is-settings-destination \.top-help-symbol \{[^}]*translateY\(22px\)/s);
  assert.match(layout,/body\.is-settings-destination \.top-github-symbol \{[^}]*translateY\(0\)/s);
  assert.match(html,/id="refresh-app"/);
  assert.match(html,/id="full-cleanup"/);
  assert.match(html,/settings\.fullcleanuphint/);
  assert.match(sheets,/\.settings-icon-red \{[^}]*#ff3b30/s);
  assert.match(html,/id="version"><\/span>/,'version is filled from the generated VERSION module');
  assert.match(html,/id="open-release-notes"[^>]*aria-haspopup="dialog"/);
  assert.match(bootstrap,/registration\?\.update\?\.\(\)/);
  assert.match(bootstrap,/stylio-result-preview-v1/);
  assert.match(bootstrap,/photographic-style-port-/);
});

test('light destructive confirmation uses the higher-contrast iOS-like palette while dark keeps semantic materials',()=>{
  const sheets=readFileSync(new URL('../../web/styles/components/sheets.css',import.meta.url),'utf8');
  assert.match(sheets,/\.ios-confirm-dialog \{[^}]*--confirm-bg: rgb\(246 246 248 \/ \.94\);[^}]*--confirm-detail: #48484a;[^}]*--confirm-secondary: #e7e7ec/s);
  assert.match(sheets,/\.ios-confirm-cancel \{[^}]*background: var\(--accent\);[^}]*color: var\(--confirm-cancel-fg\)/s);
  assert.match(sheets,/\.ios-confirm-destructive \{[^}]*background: var\(--confirm-secondary\);[^}]*color: #d70015/s);
  assert.match(sheets,/:root\[data-theme="dark"\] \.ios-confirm-dialog \{[^}]*--confirm-bg: rgb\(var\(--glass-rgb\) \/ \.78\)/s);
});

test('popup and confirm overlays use compact iOS-style entrance motion with reduced-motion fallbacks',()=>{
  const results=readFileSync(new URL('../../web/styles/components/results.css',import.meta.url),'utf8');
  const sheets=readFileSync(new URL('../../web/styles/components/sheets.css',import.meta.url),'utf8');
  assert.match(results,/\.task-action-menu \{[^}]*transform-origin: right center;[^}]*animation: task-popover-in 220ms cubic-bezier\(\.32,\.72,0,1\) both/s);
  assert.match(results,/@keyframes task-popover-in \{[\s\S]*?scale\(\.92\)[\s\S]*?scale\(1\)/s);
  assert.match(results,/@media\(prefers-reduced-motion:reduce\) \{[\s\S]*?\.task-action-menu,[\s\S]*?animation: none/s);
  assert.match(sheets,/\.ios-confirm-dialog\[open\] \{[^}]*animation: ios-alert-in 240ms cubic-bezier\(\.32,\.72,0,1\) both/s);
  assert.match(sheets,/\.ios-confirm-dialog\[open\]::backdrop \{[^}]*animation: ios-alert-backdrop-in 180ms ease-out both/s);
});

test('first-run notice is a single grouped card and appearance controls are interactive and persisted',()=>{
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  const workspace=readFileSync(new URL('../../web/styles/layout/workspace.css',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../../web/src/ui/page-bootstrap.js',import.meta.url),'utf8');
  const sheets=readFileSync(new URL('../../web/styles/components/sheets.css',import.meta.url),'utf8');
  const base=readFileSync(new URL('../../web/styles/foundations/base.css',import.meta.url),'utf8');
  const shellLayout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const strings=readFileSync(new URL('../../web/src/ui/i18n.js',import.meta.url),'utf8');
  assert.match(workspace,/\.photo-format-tip \{[^}]*grid-template-columns: 17px minmax\(0,1fr\) auto;[^}]*margin: 10px 0 8px;[^}]*border-radius: 16px;[^}]*background: var\(--surface-secondary\)/s);
  assert.match(workspace,/\.photo-format-tip>svg \{[^}]*align-self: center;[^}]*margin-top: 0/s);
  assert.match(workspace,/\.photo-format-tip button \{[^}]*grid-column: 3;[^}]*min-height: 44px/s);
  assert.match(strings,/"tip\.firstbody": "Select photos → <b>•••<\/b> → <b>Options<\/b><br>→ <b>Format<\/b> → <b>Current<\/b>\."/);
  assert.match(html,/data-theme-value="light"/);
  assert.match(html,/data-theme-value="system"/);
  assert.match(html,/data-theme-value="dark"/);
  assert.doesNotMatch(html,/data-theme-value="(?:light|system|dark)"[^>]*aria-disabled="true"/);
  assert.match(html,/id="app-color-scheme" name="color-scheme" content="light"/);
  assert.match(html,/id="app-theme-color" name="theme-color" content="#f2f2f7"/);
  assert.doesNotMatch(html,/name="theme-color"[^>]*media="\(prefers-color-scheme:/);
  assert.match(bootstrap,/stylio-theme-v1/);
  assert.match(bootstrap,/root\.dataset\.theme/);
  assert.match(bootstrap,/const systemThemeQuery=matchMedia\('\(prefers-color-scheme: dark\)'\)/);
  assert.match(bootstrap,/function syncBrowserChrome\(theme=currentTheme\(\)\)/);
  assert.match(bootstrap,/themeColorMeta\.content=dark\?'#000000':'#f2f2f7'/);
  assert.match(bootstrap,/colorSchemeMeta\.content=resolved/);
  assert.match(bootstrap,/systemThemeQuery\.addEventListener\('change',syncSystemThemeChrome\)/);
  assert.match(bootstrap,/theme-transition/);
  assert.match(bootstrap,/animate:true/);
  assert.match(base,/html\.theme-transition body/);
  assert.match(shellLayout,/#boot \{[^}]*background: linear-gradient\(100deg,var\(--ai-blue\),var\(--ai-violet\)/s);
  assert.match(shellLayout,/@keyframes boot-soft-pulse/);
  assert.match(sheets,/\.settings-row-stack/);
  assert.match(html,/id="header-guide" class="icon-button top-guide glass-surface"/);
});
test('semantic icon palette switches internal app icons to dark material without changing install icons',()=>{
  const tokens=readFileSync(new URL('../../web/styles/foundations/tokens.css',import.meta.url),'utf8');
  const sheets=readFileSync(new URL('../../web/styles/components/sheets.css',import.meta.url),'utf8');
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const results=readFileSync(new URL('../../web/styles/components/results.css',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  const manifest=readFileSync(new URL('../../web/manifest.webmanifest',import.meta.url),'utf8');
  assert.match(tokens,/@media\(prefers-color-scheme:dark\)[\s\S]*?--icon-blue-bg: var\(--icon-dark-tile\);[\s\S]*?--icon-blue-fg: #0a84ff/s);
  assert.match(tokens,/:root\[data-theme="dark"\][\s\S]*?--appearance-icon-bg: var\(--icon-dark-tile\);[\s\S]*?--appearance-icon-fg: #f5f5f7/s);
  assert.match(tokens,/:root\[data-theme="dark"\][\s\S]*?--icon-green-bg: var\(--icon-dark-tile\)/s);
  assert.match(sheets,/\.settings-icon-blue \{ background: var\(--icon-blue-bg\); color: var\(--icon-blue-fg\) \}/);
  assert.match(layout,/\.guide-icon-purple \{ background: var\(--icon-purple-bg\); color: var\(--icon-purple-fg\) \}/);
  assert.match(layout,/\.logo-dark \{ opacity: 0 \}/);
  assert.match(layout,/:root\[data-theme="dark"\] \.logo-dark \{ opacity: 1 \}/);
  assert.match(html,/photographic-styles-dark\.svg/);
  assert.match(manifest,/icons\/icon-192-v2\.png/);
  assert.match(manifest,/icons\/icon-512-v2\.png/);
  assert.doesNotMatch(manifest,/dark/i);
  assert.match(results,/meta\.camera[^}]*var\(--icon-detail-blue\)/);
  assert.match(results,/meta\.capture[^}]*var\(--icon-detail-green\)/);
});

test('browser focus and Tab rings are visually suppressed across the app',()=>{
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const sheets=readFileSync(new URL('../../web/styles/components/sheets.css',import.meta.url),'utf8');
  const base=readFileSync(new URL('../../web/styles/foundations/base.css',import.meta.url),'utf8');
  const portrait=readFileSync(new URL('../../web/styles/components/portrait-editor.css',import.meta.url),'utf8');
  assert.match(base,/:focus,\s*\n:focus-visible \{[^}]*outline: none!important;[^}]*outline-offset: 0!important/s);
  assert.doesNotMatch(base,/outline: 3px solid var\(--focus-ring\)/);
  assert.match(layout,/#history-search:focus,[\s\S]*?#history-search:focus-visible \{[^}]*outline: none;[^}]*box-shadow: none/s);
  assert.doesNotMatch(layout,/\.dock-search-field:has\(#history-search:focus-visible\)/);
  assert.match(sheets,/\.language-row:has\(#lang:focus-visible\),[\s\S]*?box-shadow: none/s);
  assert.match(portrait,/\.ai-aperture-track:has\(input:focus-visible\) \{[^}]*box-shadow: none/s);
  assert.doesNotMatch(portrait,/outline: 2px solid #0894ff/);
});
test('mobile header is fixed and adds a light full-bar blur only after content reaches it',()=>{
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../../web/src/ui/page-bootstrap.js',import.meta.url),'utf8');
  assert.match(layout,/@media\(max-width:767px\)[\s\S]*?\.top \{[^}]*position: fixed;[^}]*top: 0;[^}]*width: 100%;[^}]*padding: calc\(env\(safe-area-inset-top,0px\) \+ 24px\)[^}]*border-bottom: \.5px solid transparent;[^}]*background: var\(--bg\)/s);
  assert.match(layout,/\.top\.has-scroll-divider \{[^}]*border-bottom-color: var\(--line\);[^}]*background: color-mix\(in srgb,var\(--bg\) 70%,transparent\);[^}]*backdrop-filter: blur\(30px\) saturate\(165%\);[^}]*-webkit-backdrop-filter: blur\(30px\) saturate\(165%\)/s);
  assert.match(bootstrap,/classList\.toggle\('has-scroll-divider',window\.scrollY>12\)/);
  assert.match(bootstrap,/window\.addEventListener\('scroll',queueTopBarDivider,\{passive:true\}\)/);
  assert.doesNotMatch(layout,/\.top\.is-scrolled::before/);
});

test('iPhone Safari gets a visual Add to Home Screen guide while standalone and non-iPhone clients stay in the app',()=>{
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../../web/src/ui/page-bootstrap.js',import.meta.url),'utf8');
  const strings=readFileSync(new URL('../../web/src/ui/i18n.js',import.meta.url),'utf8');
  const fixture=readFileSync(new URL('./fixtures/mobile-shell.js',import.meta.url),'utf8');
  assert.match(html,/id="ios-install-guide" class="ios-install-guide"[^>]*aria-modal="true"[^>]*hidden/);
  assert.match(html,/install-step-icon-neutral/);assert.match(html,/install-step-icon-blue/);assert.match(html,/install-step-icon-violet/);assert.match(html,/install-step-app/);
  assert.match(html,/class="install-guide-orbit install-guide-orbit-model"><svg class="ai-model-network-symbol"/);
  assert.match(layout,/\.ios-install-guide \{[^}]*position: fixed;[^}]*z-index: 100;[^}]*overflow-y: auto;[^}]*touch-action: pan-y;[^}]*user-select: none;[^}]*-webkit-user-select: none;[^}]*background: var\(--bg\);[^}]*padding: calc\(env\(safe-area-inset-top,0px\) \+ 12px\)[^;]*max\(calc\(env\(safe-area-inset-bottom,0px\) \+ 28px\),132px\)/s);
  assert.match(layout,/\.ios-install-guide :focus,[\s\S]*?\.ios-install-guide :focus-visible \{[^}]*outline: none!important;[^}]*outline-offset: 0!important/s);
  assert.match(layout,/\.ios-install-guide\.is-leaving \{[^}]*animation: install-guide-out 280ms cubic-bezier\(\.32,\.72,0,1\) both/s);
  assert.match(layout,/main\.is-install-guide-entering \{[^}]*animation: install-app-in 320ms cubic-bezier\(\.32,\.72,0,1\) both/s);
  assert.match(layout,/\.install-guide-continue \{[^}]*transition: transform 380ms cubic-bezier\(\.37,\.36,\.03,1\.34\)/s);
  assert.match(layout,/\.install-guide-shell \{[^}]*display: grid;[^}]*gap: 18px/s);
  assert.match(layout,/\.install-guide-hero \{[^}]*min-height: 172px;[^}]*border-radius: 32px/s);
  assert.match(layout,/\.install-guide-step \{[^}]*min-height: 70px;[^}]*padding: 11px 16px/s);
  assert.match(layout,/\.install-guide-orbit-model \{[^}]*right: 28px;[^}]*bottom: 24px;[^}]*background: var\(--appearance-icon-bg\)/s);
  assert.match(html,/class="install-step-icon install-step-app"[^>]*>[\s\S]*?install-guide-logo-light[\s\S]*?photographic-styles\.svg[\s\S]*?install-guide-logo-dark[\s\S]*?photographic-styles-dark\.svg/s);
  assert.match(layout,/\.install-step-app \{[^}]*position: relative;[^}]*overflow: hidden/s);
  assert.match(layout,/\.install-step-app img \{[^}]*position: absolute;[^}]*inset: 0/s);
  assert.match(bootstrap,/const iphoneSafari=\/iPhone\|iPod\/i\.test\(userAgent\)/);
  assert.match(bootstrap,/!\/\(CriOS\|FxiOS\|EdgiOS\|OPiOS\)\/i\.test\(userAgent\)/);
  assert.match(bootstrap,/navigator\.standalone===true\|\|matchMedia\('\(display-mode: standalone\)'\)\.matches/);
  assert.match(bootstrap,/if\(iphoneSafari&&!standalone\)/);
  assert.match(bootstrap,/installGuide\.classList\.add\('is-leaving'\)/);
  assert.match(bootstrap,/appMain\?\.classList\.add\('is-install-guide-entering'\)/);
  assert.match(bootstrap,/setTimeout\(finishInstallGuideClose,320\)/);
  assert.match(bootstrap,/installGuide\.addEventListener\('dblclick',preventInstallGuideZoom,\{passive:false\}\)/);
  assert.match(bootstrap,/installGuide\.addEventListener\('touchmove',preventInstallGuideZoom,\{passive:false\}\)/);
  assert.match(fixture,/fixtureParams\.get\('state'\)==='install-guide'/);
  assert.match(strings,/"install\.title": "Use Stylio like an app"/);
  assert.match(strings,/"install\.menutitle": "Open Safari menu"/);
  assert.match(strings,/"install\.menuhint": "Tap the three-line menu in Safari's bottom bar\."/);
  assert.match(strings,/"install\.step1hint": "Choose Share from the Safari menu\."/);
});

test('resource failures use native-style banners and stacked labels keep compact title-to-description spacing',()=>{
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const results=readFileSync(new URL('../../web/styles/components/results.css',import.meta.url),'utf8');
  const sheets=readFileSync(new URL('../../web/styles/components/sheets.css',import.meta.url),'utf8');
  const controls=readFileSync(new URL('../../web/styles/components/controls.css',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../../web/src/ui/page-bootstrap.js',import.meta.url),'utf8');
  const application=readFileSync(new URL('../../web/src/app/application.js',import.meta.url),'utf8');
  const fixture=readFileSync(new URL('./fixtures/mobile-shell.js',import.meta.url),'utf8');
  assert.match(layout,/#boot\.err\.app-error-banner \{[^}]*grid-template-columns: 30px minmax\(0,1fr\) auto;[^}]*border-radius: 18px;[^}]*background: color-mix/s);
  assert.match(results,/\.status\.err \{[^}]*grid-template-columns: 24px minmax\(0,1fr\);[^}]*border-radius: 14px;[^}]*background: color-mix/s);
  assert.match(bootstrap,/showBootError\(t\(selector\.value,'err\.resources'\),t\(selector\.value,'btn\.retry'\)\)/);
  assert.match(application,/showBootError\(T\(e\?\.code==='BROWSER_INSECURE_CONTEXT'\?'err\.setup':'err\.resources'\)\)/);
  assert.match(fixture,/fixtureParams\.get\('state'\)==='resource-error'/);
  assert.match(fixture,/copy\.textContent=T\('err\.resources'\)/);
  assert.match(controls,/\.ai-hint \{[^}]*line-height: 1\.4;[^}]*margin: 2px 0 0/s);
  assert.match(sheets,/\.settings-row-stack \{[^}]*gap: 2px/s);
  assert.match(sheets,/\.settings-inline-note \{[^}]*line-height: 1\.35/s);
});

test('sheets and photo workspace close with motion while the photo header protects the Dynamic Island safe area',()=>{
  const sheets=readFileSync(new URL('../../web/styles/components/sheets.css',import.meta.url),'utf8');
  const results=readFileSync(new URL('../../web/styles/components/results.css',import.meta.url),'utf8');
  const shell=readFileSync(new URL('../../web/src/ui/shell/app-shell.js',import.meta.url),'utf8');
  assert.match(sheets,/\.sheet\.is-closing \{[^}]*sheet-out/s);
  assert.match(sheets,/@keyframes sheet-out/);
  assert.match(results,/@media\(max-width:767px\)[\s\S]*?\.photo-workspace>\.sheet-header \{[^}]*padding-top: calc\(20px \+ env\(safe-area-inset-top,0px\)\)[^}]*backdrop-filter: none/s);
  assert.match(results,/\.photo-workspace\[open\] \{[^}]*photo-workspace-in/s);
  assert.match(results,/\.photo-workspace\.is-closing \{[^}]*photo-workspace-out/s);
  assert.match(shell,/photo\.classList\.add\('is-closing'\)/);
  assert.match(shell,/photoClosingTimer=later\(finish,180\)/);
  assert.match(results,/\.photo-workspace:focus,[\s\S]*?\.photo-workspace:focus-visible \{[^}]*outline: none/s);
});

test('photo details and guide use compact icon-led disclosures instead of dense always-visible copy',()=>{
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  const results=readFileSync(new URL('../../web/styles/components/results.css',import.meta.url),'utf8');
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const resultView=readFileSync(new URL('../../web/src/ui/results/result-view.js',import.meta.url),'utf8');
  assert.equal([...html.matchAll(/class="guide-card"/g)].length,4);
  assert.equal([...html.matchAll(/class="guide-icon /g)].length,4);
  assert.match(html,/data-i18n="guide\.seemore"/);
  assert.match(html,/data-i18n="guide\.showless"/);
  assert.match(layout,/\.guide-card>summary \{[^}]*grid-template-columns: 38px minmax\(0,1fr\) auto/s);
  assert.match(layout,/\.guide-card-body \{[^}]*padding: 0 16px 16px;[^}]*border-top/s);
  assert.doesNotMatch(layout,/\.guide-card-body \{[^}]*66px/s);
  assert.match(results,/\.result-meta-row \{[^}]*grid-template-columns: 26px minmax\(0,1fr\)/s);
  assert.match(results,/\.detail-group-title \{/);
  assert.match(results,/\.details-summary-icon,/);
  assert.match(resultView,/details\.processing/);
  assert.match(resultView,/details\.photo/);
  assert.match(resultView,/className='result-meta-icon'/);
  assert.match(resultView,/className='detail-note-icon'/);
  assert.match(resultView,/el\.dataset\.preview=hasPreview\?'on':'off'/);
  assert.match(resultView,/presentation\?\.quickActions/);
  assert.match(resultView,/kind:'share'/);
  assert.match(resultView,/kind:'download'/);
  assert.match(resultView,/kind:'delete'/);
  assert.match(resultView,/if\(!text\)\{[\s\S]*?note\?\.remove\(\)/);
  assert.doesNotMatch(resultView,/this\.note\('', 'metadata'\)/);
  assert.doesNotMatch(resultView,/className='result-notice'/);
});

test('photo actions use a compact liquid-glass capsule that expands on interaction and collapses on scroll',()=>{
  const results=readFileSync(new URL('../../web/styles/components/results.css',import.meta.url),'utf8');
  const materials=readFileSync(new URL('../../web/styles/components/materials.css',import.meta.url),'utf8');
  const shell=readFileSync(new URL('../../web/src/ui/shell/app-shell.js',import.meta.url),'utf8');
  const action=results.match(/\.photo-workspace \.act \{([^}]+)\}/)[1];
  assert.match(action,/bottom: max\(18px/);
  assert.match(action,/width: min\(380px,calc\(100% - 112px\)\)/);
  assert.match(action,/border-radius: 22px/);
  assert.match(results,/\.photo-workspace \.act\.is-expanded \{[^}]*width: min\(660px,calc\(100% - 32px\)\)[^}]*border-radius: 26px/s);
  assert.match(shell,/actions\?\.addEventListener\('pointerdown',expandActions/);
  assert.match(shell,/photo\.addEventListener\('scroll',collapseActions/);
  assert.doesNotMatch(action,/border-top:/);
  assert.match(materials,/\.glass-surface,\.photo-workspace \.act/);
  assert.match(materials,/\.photo-workspace \.act \{ --glass-blur: 20px; --glass-opacity: \.58 \}/);
  assert.match(results,/@media\(min-width:768px\) \{[\s\S]*?\.photo-workspace:has\(#photo-content>\.row\[data-preview="off"\]\) \{[^}]*height: auto;[^}]*max-height: min\(90dvh,620px\)/s);
  assert.match(results,/@media\(max-width:767px\) \{[\s\S]*?\.photo-workspace \{[^}]*height: 100dvh/s);
});
test('tab glass ports measured iOS27 platter, lens, drag and release geometry while keeping badges anchored',()=>{
  const css=readFileSync(new URL('../../web/styles/components/navigation-effects.css',import.meta.url),'utf8');
  const layout=readFileSync(new URL('../../web/styles/layout/app-shell.css',import.meta.url),'utf8');
  const materials=readFileSync(new URL('../../web/styles/components/materials.css',import.meta.url),'utf8');
  const workspace=readFileSync(new URL('../../web/styles/layout/workspace.css',import.meta.url),'utf8');
  const tokens=readFileSync(new URL('../../web/styles/foundations/tokens.css',import.meta.url),'utf8');
  const shell=readFileSync(new URL('../../web/src/ui/shell/app-shell.js',import.meta.url),'utf8');
  const glass=readFileSync(new URL('../../web/src/ui/shell/tab-glass.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
  assert.match(glass,/const BAR_EXPANSION_PT=14\.14/);
  assert.match(glass,/const HELD_EXTRA_PT=16/);
  assert.match(glass,/\[\.133,\.736,25\.94,2\.77,\.951\]/);
  assert.match(glass,/\[\.467,1\.018,11\.3,20\.75,1\]/);
  assert.match(glass,/const stretch=Math\.min\(HELD_EXTRA_PT,32\*velocity\*velocity\)/);
  assert.match(css,/\.app-tabs\.is-pressing \{[^}]*transform: scale\(var\(--ios27-bar-held-scale,1\.038\)\) translateZ\(0\);[^}]*transition: transform 367ms linear\(0,0\.148 9%,0\.46 18%,0\.752 27%,0\.951 36%,1\.052 45%,1\.081 54%,1\.058 72%,1\.019 86%,1\)/s);
  assert.match(css,/\.app-tabs\.is-pressing::before \{[^}]*animation: ios27-tab-lens-press 900ms linear both/s);
  assert.match(css,/\.app-tabs\.is-pressing button\.is-previewed,[\s\S]*?transform: scale\(1\.1\)/s);
  assert.match(css,/@keyframes ios27-tab-lens-release/);
  assert.match(css,/\.app-tabs\.is-releasing \{[^}]*transition: transform 367ms linear\(0,0\.096 9%,0\.356 18%,0\.64 27%,0\.863 36%,1 45%,1\.078 54%,1\.092 59%,1\.018 95%,1\)/s);
  assert.match(css,/var\(--selection-active-fill\)/);
  assert.match(css,/\.app-tabs \{[^}]*overflow: visible;[^}]*contain: layout style/s);
  assert.match(tokens,/:root\[data-theme="dark"\][\s\S]*?--tab-lens-active-background: radial-gradient/s);
  assert.match(shell,/--tab-rest-offset/);
  assert.match(css,/touch-action: pan-y/);
  assert.match(layout,/translate: var\(--lens-offset,var\(--tab-rest-offset,calc\(var\(--tab-index,0\) \* 100%\)\)\) 0/);
  assert.match(css,/\.app-tabs\.is-dragging::before/);
  assert.match(css,/contain: paint/);
  assert.match(layout,/\.tab-icon-wrap \{[^}]*position: relative/s);
  assert.match(layout,/\.tab-count \{[^}]*top: -7px;[^}]*right: -10px/s);
  assert.match(html,/class="tab-icon-wrap"[^>]*>[\s\S]*?id="history-count" class="tab-count"/);
  assert.match(layout,/\.app-tabs svg \{[^}]*stroke-width: 2\.05/s);
  assert.match(materials,/\.app-tabs button\[aria-current="page"\] svg \{ stroke-width: 2\.35 \}/);
  assert.match(materials,/\.dock-search svg \{ stroke-width: 2\.15/);
  assert.match(workspace,/\.ai-discovery-pill \{[^}]*rgb\(var\(--glass-rgb\) \/ \.42\)/s);
  assert.match(workspace,/#ai-settings-discovery-copy \{[^}]*background: var\(--gradient\)/s);
  assert.match(workspace,/ai-discovery-spring/);
  assert.match(workspace,/@media\(max-width:767px\)[\s\S]*?\.ai-settings-discovery \{[^}]*display: none!important/s);
  assert.match(workspace,/\.ai-settings-trigger::before \{[^}]*conic-gradient\([^}]*var\(--ai-blue\)[^}]*var\(--ai-violet\)[^}]*var\(--ai-coral\)/s);
  assert.match(workspace,/\.depth-options:has\(\.ai-settings-discovery:not\(\[hidden\]\)\) \.ai-settings-trigger::before \{[^}]*animation: ai-settings-ring-spin/s);
  assert.match(workspace,/ai-settings-ring-spin/);
  assert.match(workspace,/prefers-reduced-motion:reduce[\s\S]*?\.ai-settings-trigger::before,[\s\S]*?animation: none/s);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/prefers-reduced-transparency:reduce/);
  assert.match(css,/forced-colors:active/);
  // The fixed placement host remains unfiltered; only the active dark lens
  // uses a small optical pass, with high-contrast/transparency fallbacks.
  assert.doesNotMatch(css,/\.app-tabs \{[^}]*backdrop-filter:/s);
  assert.match(css,/backdrop-filter: var\(--tab-lens-active-filter,none\)/);
});
