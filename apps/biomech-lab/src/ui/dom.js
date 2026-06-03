export function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function clear(element) {
  while (element.firstChild) element.firstChild.remove();
}
