# Visual generation handoff

## Capability selection

A suitable capability can:

- generate or edit PNG/WebP from a supplied prompt;
- accept all reference images required by a job;
- preserve a canonical character across iterations;
- save the selected result to a known local path.

Do not require a named vendor, model, API, skill, or tool. Record the capability/service actually used in run evidence and `PET.md`.

## Native generation

For each ready entry in `visual-jobs.json`:

1. Open its `prompt_file`.
2. Attach every `input_images` file with its recorded role.
3. Generate only that job.
4. Check frame count, identity, flat chroma background, spacing, clipping, and forbidden detached effects.
5. Save the selected original, copy it to `output_path`, and record `source_path`, `qa_note`, and completion time atomically.

Use an available JSON capability to read the selected job's `output_path`, then an available file capability to create its parent and copy the selected original there. If those capabilities are unavailable, perform the same bounded JSON read and file copy with Python through the guide's locked uv environment. For the `base` job, also copy that output to `references/canonical-base.png`. Use the manifest-declared destinations; never invent parallel filenames.

After that job's required deterministic and visual checks pass, write `status: "complete"`, `source_path`, `qa_note`, and UTC `completed_at` through a temporary file plus atomic rename. Do not mark a copied but unreviewed strip complete.

One isolated worker per job prevents visual payloads and failed variants from flooding the parent context. Workers return only the selected path and a short evidence note.

## No native generator

Do not declare the workflow blocked before preparing the run. Create `visual-jobs.json`, prompts, layout guides, and reference bundles first, then offer:

1. **User-operated service:** ChatGPT image generation, Gemini, Grok Imagine, or any other service that supports prompts and reference uploads.
2. **Authorized browser assistance:** when browser control exists, offer to upload references, submit the prepared prompt, and download the selected result through the user's already logged-in session.
3. **Manual artwork:** accept files created by an artist or another application if they satisfy the same job contract.

For each external job, give the user:

- service-neutral prompt file;
- exact reference files and their roles;
- expected number/order of poses;
- required flat chroma color;
- destination filename;
- a warning not to generate the full atlas or include labels, grids, shadows, scenery, text, or guide marks.

After the file is returned, inspect and process it exactly like native output. External origin never weakens QA.

## Browser boundary

Browser assistance requires the user's authorization for that service and upload. Use their existing session; never request or expose passwords, payment details, recovery codes, or session tokens. Do not purchase credits, accept new legal terms, publish images, or upload sensitive references without explicit approval. If download automation fails, ask the user to save the image and provide its path.

## Grounding

- Only the base may be prompt-only.
- Standard rows use the canonical base and matching layout guide.
- Cardinals use the canonical base, approved standard contact sheet, and cardinal guide.
- Look row 9 uses approved cardinals; row 10 also uses completed row 9.
- Do not paste individual generations into a coherent look row or fake missing motion with deterministic transforms.
