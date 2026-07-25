use anyhow::Context;

use crate::cli::{WebRunPage, WebRunPageLine, WebRunPageLink};

pub async fn fetch_web_run_page(
    client: &reqwest::Client,
    url: &str,
    index: usize,
    lineno: Option<u64>,
) -> anyhow::Result<WebRunPage> {
    let base_url = reqwest::Url::parse(url).with_context(|| format!("invalid URL `{url}`"))?;
    let html = client
        .get(base_url.clone())
        .send()
        .await
        .with_context(|| format!("web_run open request failed for `{url}`"))?
        .error_for_status()
        .with_context(|| format!("web_run open failed for `{url}`"))?
        .text()
        .await
        .with_context(|| format!("failed to read web_run open response for `{url}`"))?;
    let title = html_title(&html).unwrap_or_else(|| url.to_string());
    let readable_html = readable_html(&html);
    let links = html_links(&readable_html, &base_url);
    let text = html_to_text(&readable_html);
    let start_line = lineno.unwrap_or(1).saturating_sub(1);
    let content = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .enumerate()
        .skip(usize::try_from(start_line).unwrap_or(usize::MAX))
        .take(240)
        .map(|(index, text)| WebRunPageLine {
            line: u64::try_from(index + 1).unwrap_or(u64::MAX),
            text: text.to_string(),
        })
        .collect();
    Ok(WebRunPage {
        ref_id: format!("turn{}view0", index),
        url: url.to_string(),
        title,
        content,
        links,
    })
}

fn html_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let start = lower[start..].find('>').map(|offset| start + offset + 1)?;
    let end = lower[start..]
        .find("</title>")
        .map(|offset| start + offset)?;
    Some(
        decode_html_entities(strip_tags(&html[start..end]))
            .trim()
            .to_string(),
    )
    .filter(|title| !title.is_empty())
}

fn html_links(html: &str, base_url: &reqwest::Url) -> Vec<WebRunPageLink> {
    let lower = html.to_lowercase();
    let mut links = Vec::new();
    let mut search_from = 0;
    while let Some(anchor_offset) = lower[search_from..].find("<a") {
        let anchor_start = search_from + anchor_offset;
        let Some(tag_end_offset) = lower[anchor_start..].find('>') else {
            break;
        };
        let tag_end = anchor_start + tag_end_offset + 1;
        let tag = &html[anchor_start..tag_end];
        let href = extract_attr(tag, "href");
        let Some(close_offset) = lower[tag_end..].find("</a>") else {
            search_from = tag_end;
            continue;
        };
        let close = tag_end + close_offset;
        if let Some(href) = href
            && let Ok(url) = base_url.join(&href)
            && matches!(url.scheme(), "http" | "https")
        {
            let text = decode_html_entities(strip_tags(&html[tag_end..close]))
                .trim()
                .to_string();
            if !text.is_empty() {
                links.push(WebRunPageLink {
                    id: u64::try_from(links.len() + 1).unwrap_or(u64::MAX),
                    text,
                    url: url.to_string(),
                });
            }
        }
        search_from = close + "</a>".len();
        if links.len() >= 80 {
            break;
        }
    }
    links
}

fn readable_html(html: &str) -> String {
    extract_element_block(html, "main")
        .or_else(|| extract_element_block(html, "article"))
        .or_else(|| extract_element_block(html, "body"))
        .unwrap_or_else(|| html.to_string())
}

fn extract_element_block(html: &str, tag: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let start = lower.find(&open)?;
    let start_content = lower[start..].find('>').map(|offset| start + offset + 1)?;
    let end = lower[start_content..]
        .find(&close)
        .map(|offset| start_content + offset)?;
    Some(html[start_content..end].to_string())
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let attr = format!("{attr}=");
    let start = lower.find(&attr)? + attr.len();
    let rest = tag[start..].trim_start();
    let quote = rest.chars().next()?;
    if quote == '"' || quote == '\'' {
        let end = rest[1..].find(quote)? + 1;
        Some(rest[1..end].to_string())
    } else {
        Some(
            rest.split_whitespace()
                .next()
                .unwrap_or_default()
                .trim_end_matches('>')
                .to_string(),
        )
    }
}

fn html_to_text(html: &str) -> String {
    let html = remove_element_blocks(html, "script");
    let html = remove_element_blocks(&html, "style");
    let mut text = String::new();
    let mut in_tag = false;
    let mut last_was_space = false;
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            if !last_was_space {
                text.push('\n');
                last_was_space = true;
            }
            continue;
        }
        if ch == '>' {
            in_tag = false;
            continue;
        }
        if in_tag {
            continue;
        }
        if ch.is_whitespace() {
            if !last_was_space {
                text.push(' ');
                last_was_space = true;
            }
        } else {
            text.push(ch);
            last_was_space = false;
        }
    }
    decode_html_entities(text)
}

fn remove_element_blocks(html: &str, tag: &str) -> String {
    let mut output = String::new();
    let mut index = 0;
    let lower = html.to_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    while let Some(start_offset) = lower[index..].find(&open) {
        let start = index + start_offset;
        output.push_str(&html[index..start]);
        let Some(end_offset) = lower[start..].find(&close) else {
            index = html.len();
            break;
        };
        index = start + end_offset + close.len();
    }
    output.push_str(&html[index..]);
    output
}

fn strip_tags(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            text.push(ch);
        }
    }
    text
}

fn decode_html_entities(text: impl Into<String>) -> String {
    text.into()
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}
