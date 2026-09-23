# Asset deployments

On 23 September 2026 the maintainer authorized splitting THE FINALS outfit assets
across as many Cloudflare Pages deployments as necessary to stay within the free
limits. This is the release policy for this repository.

- Read `docs/deployment.md` before publishing. Check the provider's current limits.
- A combined package exceeding a per-deployment limit is a signal to partition
  its dependencies, not to drop catalog items or enable a paid plan.
- The current icons/base-models/reconstruction split is not a permanent maximum
  of three hosts. Add further deployments and explicit shared runtime/validator
  routing when needed. Prove relative and cross-host dependencies before release.
- Use immutable deployment URLs. Keep old releases available for rollback and
  stable outfits. Do not replace an asset in place under an immutable URL.
- Upload and validate the assets first, then pin their exact URLs in the app
  build and CI. Test the hosted app, including phone-sized layout, before review.
- Do not commit extracted artwork, credentials or private worker logs. Do not
  enable paid services or change account/subscription settings automatically.

Agent checks and the maintainer's physical-phone acceptance are separate.
