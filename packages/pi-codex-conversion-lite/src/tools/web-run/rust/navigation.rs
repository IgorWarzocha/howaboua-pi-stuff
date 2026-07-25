use serde_json::json;

use crate::cli::{WebRunArgs, WebRunPageLine, WebRunSessionState};
use crate::page::fetch_web_run_page;
use crate::session::{has_navigation_commands, load_web_run_session, save_web_run_session};

pub async fn handle_navigation_commands(
    args: &WebRunArgs,
    client: &reqwest::Client,
) -> anyhow::Result<Option<serde_json::Value>> {
    if !has_navigation_commands(&args.commands) {
        return Ok(None);
    }
    let mut state = load_web_run_session(args);
    let mut opened = Vec::new();
    let mut finds = Vec::new();

    if let Some(open_items) = args.commands.open.as_ref() {
        for open in open_items {
            let url = resolve_open_url(&state, &open.ref_id)?;
            let page = fetch_web_run_page(client, &url, state.pages.len(), open.lineno).await?;
            state.pages.push(page.clone());
            opened.push(page);
        }
    }
    if let Some(click_items) = args.commands.click.as_ref() {
        for click in click_items {
            let url = resolve_click_url(&state, &click.ref_id, click.id)?;
            let page = fetch_web_run_page(client, &url, state.pages.len(), None).await?;
            state.pages.push(page.clone());
            opened.push(page);
        }
    }
    if let Some(find_items) = args.commands.find.as_ref() {
        for find in find_items {
            finds.push(json!({
                "ref_id": find.ref_id,
                "pattern": find.pattern,
                "matches": find_in_page(&state, &find.ref_id, &find.pattern)?,
            }));
        }
    }

    save_web_run_session(args, &state)?;
    if opened.len() == 1 && finds.is_empty() {
        return Ok(Some(json!(opened.remove(0))));
    }
    Ok(Some(json!({
        "open": opened,
        "find": finds,
    })))
}

fn resolve_open_url(state: &WebRunSessionState, ref_or_url: &str) -> anyhow::Result<String> {
    if ref_or_url.starts_with("http://") || ref_or_url.starts_with("https://") {
        return Ok(ref_or_url.to_string());
    }
    if let Some(result) = state
        .search_results
        .iter()
        .find(|result| result.ref_id == ref_or_url)
    {
        return Ok(result.url.clone());
    }
    if let Some(page) = state.pages.iter().find(|page| page.ref_id == ref_or_url) {
        return Ok(page.url.clone());
    }
    anyhow::bail!("web_run cannot resolve ref_id `{ref_or_url}`")
}

fn resolve_click_url(
    state: &WebRunSessionState,
    ref_id: &str,
    link_id: u64,
) -> anyhow::Result<String> {
    let Some(page) = state.pages.iter().find(|page| page.ref_id == ref_id) else {
        anyhow::bail!("web_run cannot resolve page ref_id `{ref_id}`")
    };
    page.links
        .iter()
        .find(|link| link.id == link_id)
        .map(|link| link.url.clone())
        .ok_or_else(|| anyhow::anyhow!("web_run cannot resolve link `{link_id}` on `{ref_id}`"))
}

fn find_in_page(
    state: &WebRunSessionState,
    ref_id: &str,
    pattern: &str,
) -> anyhow::Result<Vec<WebRunPageLine>> {
    let Some(page) = state.pages.iter().find(|page| page.ref_id == ref_id) else {
        anyhow::bail!("web_run cannot resolve page ref_id `{ref_id}`")
    };
    let needle = pattern.to_lowercase();
    Ok(page
        .content
        .iter()
        .filter(|line| line.text.to_lowercase().contains(&needle))
        .cloned()
        .collect())
}
