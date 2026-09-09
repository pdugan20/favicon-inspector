# favicon-inspector threat model

Protected assets are local/private network reachability, captured reports, configured
domains, output files, and service availability. Domain input, redirects, response headers,
image bytes, SVG/ICO content, comparison files, and report paths are untrusted.

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
