import type { FormEvent } from "react";

// Arabic native-validation messages for plain <form> elements.
// EntryForm has its own built-in handler; spread these props on raw forms so
// the browser never shows its built-in English "please fill out this field".
function labelFor(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
  if (el.id) {
    const label = el.ownerDocument.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  return el.getAttribute("aria-label") ?? "هذا الحقل";
}

export function arabicFormValidation() {
  return {
    onInvalid: (e: FormEvent<HTMLFormElement>) => {
      const el = e.target as HTMLInputElement;
      if (!("validity" in el)) return;
      const label = labelFor(el);
      el.setCustomValidity(
        el.validity.valueMissing
          ? `أكمل حقل ${label}.`
          : el.validity.rangeUnderflow
            ? `${label} لا يمكن أن يكون سالبًا.`
            : `راجع قيمة ${label}.`,
      );
    },
    onInput: (e: FormEvent<HTMLFormElement>) => {
      const el = e.target as HTMLInputElement;
      if ("setCustomValidity" in el) el.setCustomValidity("");
    },
  };
}
