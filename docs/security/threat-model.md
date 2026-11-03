# favicon-inspector threat model

Protected assets are local/private network reachability, captured reports, configured
domains, output files, and service availability. Domain input, redirects, response headers,
image bytes, SVG/ICO content, comparison files, and report paths are untrusted.

Source boundaries: `src/fetch.ts` and `src/origin.ts` retrieve remote bytes,
`src/analyze.ts` and `src/perceptualHash.ts` decode them, and `src/report.ts` writes reports.
The following are required review controls, not a claim that each is already enforced.

Required controls:

- Accept only intended HTTP(S) hosts without embedded credentials and revalidate redirects
  and resolved addresses to prevent local/private-network access.
- Bound redirects, response size, decode work, concurrency, and timeouts; malformed images
  must fail safely without exhausting the monitor.
- Classify from decoded content and treat SVG or other active formats as data, not executable
  report markup.
- Resolve report and comparison paths beneath the selected output roots and do not overwrite
  an explicit historical snapshot.
- Keep fetched content, private hosts, and environment secrets out of logs and fixtures.

Update this model when endpoint selection, redirect handling, decoders, report rendering,
filesystem output, scheduling, or network scope changes.

## Enforced fetch and decode bounds

`fetchResource()` checks credential-free HTTP(S) URLs and all resolved addresses at every
redirect, then pins those vetted addresses into the socket lookup while preserving Host
and TLS verification. Local/private, mapped/translated and special-use addresses are
rejected. A single 10-second deadline covers DNS, redirects and streamed bodies; redirect
chains stop at five hops and HTTPS redirects cannot downgrade to HTTP. Connections are
not reused across DNS checks. System DNS (including hosts files/split DNS) has a global two-lookup ceiling;
queued lookups are removed on timeout and late results cannot connect. Running OS
lookups cannot be cancelled and retain their slot until complete. Body storage
coalesces small chunks into bounded buffers. HTTP compression is not requested or accepted.

Image bodies stop at 4 MiB, HTML/manifests at 2 MiB, and an origin contributes at most 32
discovered icons in addition to four well-known paths. Relative links use the final
redirected document URL. Decoder inputs are capped at four million pixels; PNG data is
pre-inflated with an output bound and compressed ancillary metadata is omitted from
decoder input, with at most 4096 chunks. SVG hashing rejects embedded raster/font
resources, external references, entities and CSS escapes before native processing.
JPEG memory and resolution limits and a five-second sharp processing
limit bound decoding. The fetched original remains the report's image payload.

These are application controls, not a replacement for network-level egress policy.
The regression tests use synthetic inputs and owned loopback HTTP/TLS servers; no external capture or service mutation is performed.
