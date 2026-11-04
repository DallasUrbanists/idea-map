import { ref } from "vue";
import SegmentedControl from "../app/components/SegmentedControl.vue";
import { example } from "./catalog-story.js";

export default {
  title: "Components/Segmented control",
  component: SegmentedControl,
};
const state = () => ({
  value: ref("nearby"),
  options: [
    { value: "nearby", label: "Nearby" },
    { value: "saved", label: "Saved" },
    { value: "recent", label: "Recent" },
  ],
  scrollOptions: [
    { value: "nearby", label: "Nearby" },
    { value: "saved", label: "Saved" },
    { value: "recent", label: "Recent" },
    { value: "alpha", label: "Alpha" },
    { value: "beta", label: "Beta" },
    { value: "charlie", label: "Charlie" },
    { value: "delta", label: "Delta" },
    { value: "echo", label: "Echo" },
    { value: "foxtrot", label: "Foxtrot" },
  ],
});
export const Default = example(
  { SegmentedControl },
  '<div class="catalog-stack"><SegmentedControl v-model="value" :options="options" /><p role="status">Showing {{ value }} ideas</p></div>',
  state,
);
export const Fill = example(
  { SegmentedControl },
  '<div class="catalog-stack"><SegmentedControl v-model="value" :options="options" layout="fill" /></div>',
  state,
);
export const Disabled = example(
  { SegmentedControl },
  '<SegmentedControl model-value="nearby" :options="options" disabled />',
  state,
);
export const DisabledOption = example(
  { SegmentedControl },
  "<SegmentedControl v-model=\"value\" :options=\"[{ value: 'nearby', label: 'Nearby' }, { value: 'saved', label: 'Saved (sign in required)', disabled: true }, { value: 'recent', label: 'Recent' }]\" />",
  state,
);
export const Light = { ...Default, globals: { theme: "light" } };
export const Dark = { ...Default, globals: { theme: "dark" } };
export const UsageDefault = { ...Default, tags: ["!dev"] };
export const UsageFill = { ...Fill, tags: ["!dev"] };