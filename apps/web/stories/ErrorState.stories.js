import { ref } from "vue";
import ErrorState from "../app/components/ErrorState.vue";
import Button from "../app/components/Button.vue";
import { example } from "./catalog-story.js";

export default { title: "Components/Error state", component: ErrorState };
export const Assortment = example(
  { ErrorState },
  `
    <div>
      <p>Standard</p>
      <ErrorState
        message="Could not load ideas"
        description="Check your connection"
      />
      <p>With retry button</p>
      <ErrorState
        message="Could not load ideas"
        description="Check your connection and try again."
        retryLabel="Try again"
      />
      <p>Inline</p>
      <ErrorState variant="inline" message="Could not update ideas" description="Last updated 3 minutes ago. The previous results are still shown." />
      <p>Inline with retry</p>
      <ErrorState variant="inline" retryLabel="Try again" message="Could not update ideas" description="Last updated 3 minutes ago. The previous results are still shown." />
      <p>Retrying</p>
      <ErrorState variant="inline" retryLabel="Try again" retrying="true" message="Could not update ideas" description="Your previous results are still available." retrying />
      <p>Compact</p>
      <ErrorState variant="compact" message="Cannot update" />
    </div>
  `,
);

export const UsageDefault = { ...example(
  { ErrorState, Button },
  '<div class="catalog-stack"><ErrorState v-if="failed" message="Could not load ideas" description="Your draft is safe. Try loading again." retry-label="Try again" @retry="failed = false" /><template v-else><p role="status">Ideas loaded. Your draft is still available.</p><Button variant="secondary" @click="failed = true">Simulate another failure</Button></template></div>',
  () => ({ failed: ref(true) }),
), tags: ["!dev"] };
export const UsageInline = { ...example(
  { ErrorState },
  '<ErrorState variant="inline" message="Could not update ideas" description="Last updated 3 minutes ago. The previous results are still shown." retry-label="Try again" />',
), tags: ["!dev"] };
export const UsageCompact = { ...example(
  { ErrorState },
  '<ErrorState variant="compact" message="Cannot update" />',
), tags: ["!dev"] };
