use std::io::Read;
use std::io::Write;
use std::path::Path;

use codex_utils_absolute_path::AbsolutePathBuf;
use codex_utils_path_uri::PathUri;
use serde_json::json;

use crate::AppliedPatchDelta;
use crate::AppliedPatchFileChange;

pub fn main() -> ! {
    let exit_code = run_main();
    std::process::exit(exit_code);
}

/// We would prefer to return `std::process::ExitCode`, but its `exit_process()`
/// method is still a nightly API and we want main() to return !.
pub fn run_main() -> i32 {
    // Expect either one argument (the full apply_patch payload) or read it from stdin.
    let mut args = std::env::args_os();
    let _argv0 = args.next();

    let patch_arg = match args.next() {
        Some(arg) => match arg.into_string() {
            Ok(s) => s,
            Err(_) => {
                eprintln!("Error: apply_patch requires a UTF-8 PATCH argument.");
                return 1;
            }
        },
        None => {
            // No argument provided; attempt to read the patch from stdin.
            let mut buf = String::new();
            match std::io::stdin().read_to_string(&mut buf) {
                Ok(_) => {
                    if buf.is_empty() {
                        eprintln!("Usage: apply_patch 'PATCH'\n       echo 'PATCH' | apply_patch");
                        return 2;
                    }
                    buf
                }
                Err(err) => {
                    eprintln!("Error: Failed to read PATCH from stdin.\n{err}");
                    return 1;
                }
            }
        }
    };

    // Refuse extra args to avoid ambiguity.
    if args.next().is_some() {
        eprintln!("Error: apply_patch accepts exactly one argument.");
        return 2;
    }

    let mut stdout = std::io::stdout();
    let mut stderr = std::io::stderr();
    let native_cwd = match codex_utils_absolute_path::AbsolutePathBuf::current_dir() {
        Ok(cwd) => cwd,
        Err(err) => {
            eprintln!("Error: Failed to determine current directory.\n{err}");
            return 1;
        }
    };
    let cwd = PathUri::from_abs_path(&native_cwd);
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("Error: Failed to initialize runtime.\n{err}");
            return 1;
        }
    };
    let json_output = std::env::var_os("PI_APPLY_PATCH_JSON").is_some();
    match runtime.block_on(crate::apply_patch(
        &patch_arg,
        &cwd,
        &mut stdout,
        &mut stderr,
        codex_exec_server::LOCAL_FS.as_ref(),
        /*sandbox*/ None,
    )) {
        Ok(delta) => {
            if json_output {
                let _ = write_json_result(&mut stdout, "success", None, &native_cwd, &delta);
            }
            // Flush to ensure output ordering when used in pipelines.
            let _ = stdout.flush();
            0
        }
        Err(error) => {
            if json_output {
                let message = error.to_string();
                let (_, delta) = error.into_parts();
                let _ =
                    write_json_result(&mut stdout, "failure", Some(&message), &native_cwd, &delta);
                let _ = stdout.flush();
            }
            1
        }
    }
}

fn write_json_result(
    out: &mut impl Write,
    status: &str,
    error: Option<&str>,
    cwd: &AbsolutePathBuf,
    delta: &AppliedPatchDelta,
) -> std::io::Result<()> {
    let summary = summarize_delta(cwd, delta);
    let value = json!({
        "status": status,
        "error": error,
        "exact": delta.is_exact(),
        "result": {
            "changedFiles": summary.changed_files,
            "createdFiles": summary.created_files,
            "deletedFiles": summary.deleted_files,
            "movedFiles": summary.moved_files,
            "fuzz": if delta.is_exact() { 0 } else { 1 },
        },
        "changes": summary.changes,
    });
    writeln!(out, "{value}")
}

struct DeltaSummary {
    changed_files: Vec<String>,
    created_files: Vec<String>,
    deleted_files: Vec<String>,
    moved_files: Vec<String>,
    changes: Vec<serde_json::Value>,
}

fn summarize_delta(cwd: &AbsolutePathBuf, delta: &AppliedPatchDelta) -> DeltaSummary {
    let mut changed_files = Vec::new();
    let mut created_files = Vec::new();
    let mut deleted_files = Vec::new();
    let mut moved_files = Vec::new();
    let mut changes = Vec::new();

    for change in delta.changes() {
        let path = display_path(cwd, &change.path);
        match &change.change {
            AppliedPatchFileChange::Add {
                content,
                overwritten_content,
            } => {
                push_unique(&mut changed_files, path.clone());
                if overwritten_content.is_none() {
                    push_unique(&mut created_files, path.clone());
                }
                changes.push(json!({
                    "path": path,
                    "kind": "add",
                    "content": content,
                    "overwrittenContent": overwritten_content,
                }));
            }
            AppliedPatchFileChange::Delete { content } => {
                push_unique(&mut changed_files, path.clone());
                push_unique(&mut deleted_files, path.clone());
                changes.push(json!({
                    "path": path,
                    "kind": "delete",
                    "content": content,
                }));
            }
            AppliedPatchFileChange::Update {
                move_path,
                old_content,
                overwritten_move_content,
                new_content,
            } => {
                push_unique(&mut changed_files, path.clone());
                let move_path_display = move_path
                    .as_ref()
                    .map(|move_path| display_path(cwd, move_path));
                if let Some(move_path) = &move_path_display {
                    push_unique(&mut changed_files, move_path.clone());
                    push_unique(&mut deleted_files, path.clone());
                    if overwritten_move_content.is_none() {
                        push_unique(&mut created_files, move_path.clone());
                    }
                    push_unique(&mut moved_files, format!("{path} -> {move_path}"));
                }
                changes.push(json!({
                    "path": path,
                    "kind": "update",
                    "movePath": move_path_display,
                    "oldContent": old_content,
                    "overwrittenMoveContent": overwritten_move_content,
                    "newContent": new_content,
                }));
            }
        }
    }

    DeltaSummary {
        changed_files,
        created_files,
        deleted_files,
        moved_files,
        changes,
    }
}

fn display_path(cwd: &AbsolutePathBuf, path: &Path) -> String {
    let cwd_path: &Path = cwd.as_ref();
    path.strip_prefix(cwd_path)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.contains(&value) {
        values.push(value);
    }
}
