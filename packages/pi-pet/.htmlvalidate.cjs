// Element metadata extends native HTML validation; it does not parse markup.
const { aria, roles } = require("aria-query");
const html5 = require("html-validate/elements/html5");
const concreteRoles = [...roles.entries()].filter(([, role]) => !role.abstract).map(([name]) => name);

function roleContext(node, element) {
  const value = node.getAttribute("role");
  const explicit =
    typeof value === "string" ? value.split(/\s+/).find((name) => concreteRoles.includes(name)) : undefined;
  const implicit = element.aria?.implicitRole;
  const native = typeof implicit === "function" ? implicit(node) : implicit;
  return { role: roles.get(explicit ?? native), needsProperties: explicit && explicit !== native };
}

function focusable(node, element) {
  const native = element.focusable;
  return (typeof native === "function" ? native(node) : Boolean(native)) || node.hasAttribute("tabindex");
}

function ariaValue(definition) {
  switch (definition.type) {
    case "boolean":
      return { enum: ["true", "false", ...(definition.allowundefined ? ["undefined"] : [])] };
    case "tristate":
      return { enum: ["true", "false", "mixed", "undefined"] };
    case "token":
    case "tokenlist":
      return { enum: definition.values.map(String), list: definition.type === "tokenlist" };
    case "integer":
      return { enum: [/^[+-]?\d+$/] };
    case "number":
      return { enum: [/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i] };
    case "id":
    case "idlist":
      return { enum: [/^\S+$/], list: definition.type === "idlist", reference: "id" };
    case "string":
      return {};
    default:
      throw new Error(`Unsupported aria-query value type: ${definition.type}`);
  }
}

// Reuse the native implicit-role metadata, so HTML controls satisfy their own
// semantics without redundant ARIA. Only a non-native explicit role needs its
// required ARIA properties spelled out in markup.
const ariaMetadata = Object.fromEntries(
  Object.entries(html5).map(([tag, element]) => [
    tag,
    {
      attributes: {
        ...(tag === "*"
          ? {
              "aria-*": null,
              accesskey: { allowed: () => "must not assign browser access keys" },
              autofocus: { allowed: () => "must not move focus automatically" },
              tabindex: {
                ...html5["*"].attributes.tabindex,
                allowed: (_node, value) => (Number(value) > 0 ? "must not use a positive tabindex" : null),
              },
            }
          : {}),
        role: {
          enum: concreteRoles,
          list: true,
          allowed: (node) => {
            const { role } = roleContext(node, element);
            return role?.superClass.some((path) => path.includes("widget")) && !focusable(node, element)
              ? "requires a focusable element"
              : null;
          },
        },
        ...Object.fromEntries(
          [...aria.entries()].map(([name, definition]) => [
            name,
            {
              ...html5["*"].attributes[name],
              ...ariaValue(definition),
              required: (node) => {
                const { role, needsProperties } = roleContext(node, element);
                return Boolean(needsProperties && Object.hasOwn(role.requiredProps, name));
              },
              allowed: (node) => {
                const { role } = roleContext(node, element);
                if (role && (!Object.hasOwn(role.props, name) || role.prohibitedProps.includes(name)))
                  return "is not supported by this element's ARIA role";
                return name === "aria-activedescendant" && !focusable(node, element)
                  ? "requires a focusable element"
                  : null;
              },
            },
          ]),
        ),
      },
    },
  ]),
);

const safeUrl = (_node, value) => {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\t\n\r]/g, "")
    .trimStart()
    .toLowerCase();
  // oxlint-disable-next-line no-script-url -- Reject this scheme in native HTML attribute validation.
  return normalized.startsWith("javascript:") ? "must not use a javascript: URL" : null;
};
const blankTarget = (node) => {
  const target = node.getAttribute("target");
  return typeof target === "string" && target.toLowerCase() === "_blank";
};
const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const scriptNames = new Intl.DisplayNames(["en"], { type: "script", fallback: "none" });
function validLanguage(_node, value) {
  try {
    if (typeof value !== "string" || !value) return "requires a language tag";
    const locale = new Intl.Locale(value);
    if (
      !languageNames.of(locale.language) ||
      (locale.region && !regionNames.of(locale.region)) ||
      (locale.script && !scriptNames.of(locale.script)) ||
      locale.baseName !== [locale.language, locale.script, locale.region].filter(Boolean).join("-")
    )
      return "requires a recognized language/script/region tag";
    return null;
  } catch {
    return "requires a valid language tag";
  }
}
const linkAttributes = {
  href: { allowed: safeUrl },
  rel: {
    required: blankTarget,
    allowed: (node, value) => {
      if (!blankTarget(node)) return null;
      const tokens = typeof value === "string" ? value.toLowerCase().split(/\s+/) : [];
      return tokens.includes("noopener") || tokens.includes("noreferrer")
        ? null
        : 'must include "noopener" or "noreferrer" when target is "_blank"';
    },
  },
};

module.exports = {
  root: true,
  extends: [],
  elements: [
    "html5",
    ariaMetadata,
    {
      a: { attributes: linkAttributes },
      area: { attributes: linkAttributes },
      html: { attributes: { lang: { required: true, allowed: validLanguage } } },
      iframe: { attributes: { src: { allowed: safeUrl } } },
      // Valid platform attributes missing from html-validate 11.4's metadata.
      link: { attributes: { type: {} } },
      canvas: { attributes: { width: {}, height: {} } },
      textarea: { attributes: { placeholder: {} } },
      // Accessible text accepts title/ARIA labels, but not an unnamed visible SVG.
      svg: { textContent: "accessible" },
    },
  ],
  rules: {
    "area-alt": "error",
    "aria-hidden-body": "error",
    "aria-label-misuse": "error",
    "attribute-allowed-values": "error",
    "attribute-misuse": "error",
    "close-attr": "error",
    "close-order": "error",
    "element-permitted-content": "error",
    "element-permitted-occurrences": "error",
    "element-permitted-parent": "error",
    "element-required-ancestor": "error",
    "element-required-attributes": "error",
    "element-required-content": "error",
    "empty-heading": "error",
    "empty-title": "error",
    "hidden-focusable": "error",
    "input-missing-label": "error",
    "multiple-labeled-controls": "error",
    "no-abstract-role": "error",
    "no-autoplay": "error",
    "no-dup-attr": "error",
    "no-dup-id": "error",
    "no-implicit-button-type": "error",
    "no-missing-references": "error",
    "no-redundant-role": "error",
    "no-unknown-attributes": "error",
    "no-unknown-elements": "error",
    "no-unused-disable": "error",
    "prefer-native-element": "error",
    "text-content": "error",
    "valid-autocomplete": "error",
    "valid-for": "error",
    "void-content": "error",
    "wcag/h30": "error",
    "wcag/h32": "error",
    "wcag/h36": "error",
    "wcag/h37": "error",
    "wcag/h63": "error",
    "wcag/h67": "error",
    "wcag/h71": "error",
  },
};
