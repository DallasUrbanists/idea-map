# Evaluate a compliance-scoring candidate

This guide helps reviewers reproduce an offline experiment for the moderation
score. The experiment uses invented labels and invented provider signals; it
does not measure a real provider or establish a safe publication policy. The
current candidate fails an illustrative safety case and must not be used for
automatic approval. The [moderation policy](../policies/moderation-policy.md)
defines the actual requirements.

The following contents links navigate within this guide:

- [When to use this guide](#when-to-use-this-guide)
- [Candidate and inputs](#candidate-and-inputs)
- [Run the synthetic evaluation](#run-the-synthetic-evaluation)
- [Results and limits](#results-and-limits)
- [Provider review](#provider-review)
- [Acceptance evidence](#acceptance-evidence)

## When to use this guide

| When this happens... | Use this guide to... |
| --- | --- |
| You need to reproduce the scoring experiment. | Run the offline evaluation using invented signals and labels. |
| You are reviewing the candidate's results. | Interpret its synthetic failures and the limits of the evidence. |
| You are considering a scoring decision. | Identify the evaluation and provider evidence needed for acceptance. |

## Candidate and inputs

The `synthetic-logistic-v0` experiment trains separate logistic models for text
and images. Text inputs are four fictional values shaped like the Toxic,
Derogatory, Violent, and Sexual confidence signals. Image inputs are two
fictional SafeSearch categories, adult and violence, encoded as one-hot labels;
the model learns coefficients from the training labels rather than assigning a
percentage to a SafeSearch label. The script trains with deterministic batch
gradient descent and L2 regularization, then uses the lowest component score for
the whole revision.

The candidate requires a text result, the declared number of image results,
supported language, and a complete policy-coverage assertion. Missing data,
unknown image labels, unsupported language, and incomplete coverage return no
score. The coverage assertion is an **invented test input**, not a real proof of
rights, privacy, threats, harassment, or other policy requirements. The existing
providers alone do not establish all those requirements; a real implementation
must verify coverage from independently justified evidence and fail closed when it
cannot do so.

The experiment's output is a model value on a 0–100 scale. It is not calibrated
against real submissions and must not be interpreted as a measured probability
of compliance. An accepted contract must bind the exact revision and media,
assessment and scoring versions, completeness, failure state, and server-recorded
receipt time; no client-provided score or coverage claim may grant approval.

## Run the synthetic evaluation

Use the [development setup](../contributor-guides/development-guide.md#one-time-setup-for-each-checkout)
and run these commands from the repository root:

```sh
node scripts/evaluate-compliance.mjs
node --test scripts/compliance-candidate.test.mjs
```

The evaluation prints the per-case scores or unavailable state and aggregate
counts. Training and evaluation rows are separate, but both were authored for
this experiment by the same contributor. They contain no real submissions,
photos, provider calls, or independently verified provider outputs. The case
names describe intended scenarios rather than actual text or images.

## Results and limits

With the checked-in fixtures, the evaluator reports 12 cases: seven scored and
five unavailable. Four scored cases are eligible for eventual automatic approval
under the 60% threshold; eight need human review or have no score. One of the
three scored cases labelled as violations is eligible for automatic approval,
and one of the four scored cases labelled compliant is sent to human review.
No violating case in this tiny fixture reaches the 95% instant threshold.

The low-signal threat case is scored about 87.5% despite its violation label.
The civic-criticism case is scored about 41.9% despite its compliant label.
These are failures of the candidate on deliberately invented inputs, not
estimates of real-world false-negative or false-positive rates. The small,
hand-authored dataset cannot measure calibration, language performance,
real-world harm, or expected moderator workload. Its five unavailable examples
demonstrate only the implemented failure handling.

The unit test checks the adopted schedule at 59.99%, 60%, 77.5%, 95%, and 98%,
and checks strict trusted-user threshold equality. Those checks validate the
arithmetic independently of whether the candidate can produce meaningful scores.

## Provider review

Google describes Natural Language moderation category confidences as predictions
of category membership rather than severity; it cautions against relying on them
as inherently reliable decisions. See the
[Natural Language moderation guide](https://cloud.google.com/natural-language/docs/moderating-text).
Vision SafeSearch returns categorical likelihoods for five content categories;
see the [SafeSearch guide](https://cloud.google.com/vision/docs/detecting-safe-search).

The [Natural Language data-usage FAQ](https://cloud.google.com/natural-language/docs/data_usage)
and [Vision data-usage FAQ](https://cloud.google.com/vision/docs/data-usage)
describe provider handling. The latter distinguishes online and asynchronous
image processing and notes temporary request-metadata logging. The
[Natural Language location guide](https://cloud.google.com/natural-language/docs/locations)
describes regional configuration. The
[Vision OCR location guidance](https://cloud.google.com/vision/docs/ocr)
applies to OCR and does not establish regional support for SafeSearch; operators
must verify SafeSearch processing location separately. Operators must review the actual account
terms, endpoints, retention, access, consent, and current
[text](https://cloud.google.com/products/natural-language/pricing) and
[image](https://cloud.google.com/vision/pricing) costs before processing private
content; this offline experiment does not authorize provider use.

## Acceptance evidence

Before proposing a production method, reviewers need independently labelled,
representative and consented or synthetic examples with documented provenance,
separate development and evaluation sets, and explicit checks for each policy
rule and required medium. They should establish and approve measurable limits
for missed violations, false flags, calibration, subgroup performance, moderator
capacity, and provider failures before evaluating a candidate against them.

The scoring contract and method require a recorded acceptance decision. Until
that decision and the other moderation rollout gates are satisfied, the worker
must keep automatic publication disabled and route unavailable evidence to
human review.
