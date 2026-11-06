import "@fontsource-variable/figtree";
import { addons } from "storybook/preview-api";
import { INITIAL_VIEWPORTS } from "storybook/viewport";
import { DOCS_PREPARED, UPDATE_GLOBALS } from "storybook/internal/core-events";
import "../src/styles/tokens.css";
import "./preview.css";
import "./docs-theme.css";

// Unattached MDX docs do not run story decorators. Start from the preview URL
// and follow toolbar requests, rather than other frames' initialization events.
const themeChannel = addons.getChannel();
// Storybook's isolated Canvas iframes omit globals from their URLs. Inherit
// the owning docs theme without reloading the example or resetting its state.
const parentDocsRoot =
  window.frameElement?.closest(".docs-story")?.ownerDocument.documentElement;
const urlGlobals =
  new URLSearchParams(window.location.search).get("globals") || "";
let selectedTheme =
  urlGlobals.match(/(?:^|;)theme:(light|dark|system)(?:;|$)/)?.[1] || "system";
let storyTheme;
const applyTheme = () => {
  document.documentElement.dataset.theme = parentDocsRoot
    ? storyTheme || parentDocsRoot.dataset.theme || selectedTheme
    : selectedTheme;
};
const updateTheme = ({ globals }) => {
  if (["light", "dark", "system"].includes(globals?.theme))
    selectedTheme = globals.theme;
  applyTheme();
};
const applyDocsTheme = () => {
  if (new URLSearchParams(window.location.search).get("viewMode") === "docs")
    applyTheme();
};
const parentThemeObserver = parentDocsRoot
  ? new MutationObserver(() => applyTheme())
  : undefined;
parentThemeObserver?.observe(parentDocsRoot, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
applyTheme();
themeChannel.on(UPDATE_GLOBALS, updateTheme);
themeChannel.on(DOCS_PREPARED, applyDocsTheme);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    themeChannel.off(UPDATE_GLOBALS, updateTheme);
    themeChannel.off(DOCS_PREPARED, applyDocsTheme);
    parentThemeObserver?.disconnect();
  });
}

export const parameters = {
  viewport: { options: INITIAL_VIEWPORTS },
  options: {
    storySort: {
      method: "alphabetical",
      order: [
        "Foundations",
        [
          "Overview",
          "Principles",
          "Tokens",
          "Color",
          "Typography",
          "Size and space",
          "Containers",
          "Theming",
          "Before you contribute",
        ],
        "Components",
      ],
    },
  },
};

export const globalTypes = {
  theme: {
    description: "Color theme for the component preview",
    toolbar: {
      title: "Theme",
      icon: "paintbrush",
      items: ["system", "light", "dark"],
      dynamicTitle: true,
    },
  },
};

export const initialGlobals = { theme: "system" };

export const decorators = [
  (story, context) => {
    storyTheme = context.storyGlobals?.theme;
    selectedTheme = context.userGlobals?.theme || selectedTheme;
    if (parentDocsRoot) applyTheme();
    else document.documentElement.dataset.theme = context.globals.theme;
    return story();
  },
];
