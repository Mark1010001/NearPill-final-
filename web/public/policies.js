const status = document.getElementById('policyStatus');
const retry = document.getElementById('policyRetry');
const navigation = document.getElementById('policyNav');
const sections = document.getElementById('policySections');

function textElement(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

async function loadPolicies() {
  status.textContent = 'Loading service information…';
  retry.disabled = true;
  try {
    const response = await fetch('/policies.json');
    if (!response.ok) throw new Error('Policies unavailable');
    const policy = await response.json();
    if (typeof policy.updated !== 'string' || typeof policy.status !== 'string'
      || !Array.isArray(policy.sections) || !policy.sections.length
      || !policy.sections.every((item) => item && /^[a-z][a-z0-9-]*$/.test(item.id)
        && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.body === 'string')) {
      throw new Error('Invalid policy content');
    }
    const links = document.createDocumentFragment();
    const content = document.createDocumentFragment();
    content.append(textElement('p', policy.status));
    for (const item of policy.sections) {
      const link = textElement('a', item.title);
      link.href = `#${item.id}`;
      links.append(link);
      const section = document.createElement('section');
      const heading = textElement('h2', item.title);
      heading.id = item.id;
      heading.tabIndex = -1;
      section.append(heading);
      for (const paragraph of item.body.split(/\n\s*\n/)) {
        section.append(textElement('p', paragraph));
      }
      content.append(section);
    }
    navigation.replaceChildren(links);
    sections.replaceChildren(content);
    status.textContent = `Last updated ${policy.updated}`;
    retry.hidden = true;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  } catch {
    status.textContent = 'Could not load service information. Try again.';
    retry.hidden = false;
  } finally {
    retry.disabled = false;
  }
}

retry.addEventListener('click', loadPolicies);
void loadPolicies();
