export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  main() {
    const sendArtifact = (payload: {
      url: string;
      resourceType: string;
      hasIntegrityAttr?: boolean;
    }) => {
      void chrome.runtime
        .sendMessage({ type: 'DOM_ARTIFACT', payload })
        .catch(() => {
          // Ignore errors when no session is active or the context is gone.
        });
    };

    const inspectElement = (el: Element) => {
      if (el instanceof HTMLScriptElement && el.src) {
        sendArtifact({
          url: el.src,
          resourceType: 'script',
          hasIntegrityAttr: Boolean(el.integrity),
        });
      } else if (el instanceof HTMLIFrameElement && el.src) {
        sendArtifact({ url: el.src, resourceType: 'sub_frame' });
      } else if (el instanceof HTMLImageElement && el.src) {
        const isPixel =
          (el.width <= 1 && el.height <= 1) ||
          el.getAttribute('width') === '1' ||
          el.getAttribute('height') === '1';

        sendArtifact({
          url: el.src,
          resourceType: isPixel ? 'tracking_pixel' : 'image',
        });
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            inspectElement(node);
            node
              .querySelectorAll('script[src], iframe[src], img[src]')
              .forEach(inspectElement);
          }
        });
      }
    });

    observer.observe(document, { childList: true, subtree: true });

    document
      .querySelectorAll('script[src], iframe[src], img[src]')
      .forEach(inspectElement);
  },
});