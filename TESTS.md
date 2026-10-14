# Test set

30 cold email drafts in 13 languages, each with the answer a careful human would give. They live in [`tests.js`](tests.js) and the last results in [`test-results.json`](test-results.json).

Every draft is checked against the five things the US rules ask for, so every element is tested whatever language the draft is in:

- **Sender:** the sender's name and company are both in the email
- **Stop:** the email tells the reader how to refuse further emails
- **Address:** a physical postal address is there
- **Commercial:** a reader can tell it is a business offering something
- **Language:** the model names the language correctly (it picks the wording added to the fixed version)

The set includes traps: "unsubscribe" used in another sense, a signature with only a first name, "The Invoicely team" with no person, a city without a street address, a vague question with no offer, opt-outs hidden in a P.S. or phrased as "let me know and I won't follow up".

## Results, 14 October 2026

Apple Silicon Mac, Chromium with WebGPU, WebLLM, temperature 0.

| Model | Drafts fully right | Sender | Stop | Address | Commercial | Language | Seconds per draft |
|---|---|---|---|---|---|---|---|
| Gemma 4 E2B (default) | **30 / 30** | 30 | 30 | 30 | 30 | 30 | about 10.5 |
| Qwen 3.5 2B | 26 / 30 | 30 | 28 | 30 | 28 | 30 | about 7.4 |

Qwen's four misses:

- `en-wont-follow-up` and `en-relevance-stop`: it did not see "let me know and I won't follow up" or "let me know and I'll stop reaching out" as a way to say stop. The page then reports the opt-out as missing, which errs on the safe side.
- `en-vague-no-offer`: it called "who handles customer onboarding at your company?" a commercial offer.
- `fr-no-optout`: it said a French translation agency's pitch was not plainly commercial.

## What the first run found

On the first run Gemma scored 28 of 30. Both misses were mine, not the model's. Gemma found the opt-out in "just reply 'no thanks'" and "let me know and I won't follow up", quoted the right words, and then my second check threw the answer away because those phrasings were not in its list of opt-out wording. The same happened with Qwen and the Swedish "Vill du inte få fler mejl?". I widened the list, checked it still rejects sentences like "We make switching free.", and ran the whole set again.

## Run it yourself

Open [phazww.github.io/coldproof/#tests](https://phazww.github.io/coldproof/#tests) on a computer with WebGPU, pick a model and press the button. Your numbers can differ slightly between runs and machines.
