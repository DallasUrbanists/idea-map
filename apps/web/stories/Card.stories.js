import Card from "../app/components/Card.vue";
import Badge from "../app/components/Badge.vue";
import Button from "../app/components/Button.vue";
import { example } from "./catalog-story.js";

export default { title: "Components/Card", component: Card };
export const Default = example(
  { Card, Badge, Button },
  `<div class="catalog-stack">
    <Card>
      <template #header>
        <h2>Shade for the bus stop</h2>
      </template>
      <p>A community idea for a cooler, more comfortable place to wait.</p>
      <template #footer>
        <Button variant="secondary">Preview idea</Button>
        <Button variant="transparent">Discard</Button>
      </template>
    </Card>
  </div>`,
);
export const Empty = example(
  { Card },
  '<div class="catalog-stack"><Card empty><template #header><h2>No saved ideas</h2></template><p>Save an idea to find it here later.</p></Card></div>',
);
export const Hairline = example(
  { Card },
  "<Card hairline>Use a border when this card shares its surrounding surface color.</Card>",
);
export const Light = { ...Default, globals: { theme: "light" } };
export const Dark = { ...Default, globals: { theme: "dark" } };
export const UsageDefault = { ...Default, tags: ["!dev"] };
export const UsageEmpty = { ...Empty, tags: ["!dev"] };
export const UsageHairline = { ...Hairline, tags: ["!dev"] };
