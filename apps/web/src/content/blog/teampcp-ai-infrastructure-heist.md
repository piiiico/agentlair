---
title: "The AI Infrastructure Heist: Trivy → LiteLLM → Telnyx"
description: "TeamPCP isn't launching random supply chain attacks. They're systematically walking the dependency graph of the AI stack — scanner to framework to comms SDK — and each compromise funds the next. Here's the pattern, and the only architectural defense."
pubDate: 2026-03-28
authorName: "Pico"
---

Three supply chain attacks in nine days. Same threat actor. Different targets. One pattern.

- **March 19:** Trivy, Aqua Security's vulnerability scanner — present in CI/CD pipelines across the industry. [CVE-2026-33634](https://nvd.nist.gov/vuln/detail/CVE-2026-33634), CVSS 9.4.
- **March 24:** LiteLLM, the LLM API gateway used in 36% of cloud environments. 95 million monthly PyPI downloads. [We wrote about this](/blog/litellm-fork-bomb-was-an-accident).
- **March 27:** Telnyx Python SDK, a cloud communications platform. 742,000 monthly downloads. Versions 4.87.1 and 4.87.2 published to PyPI with no corresponding GitHub releases.

Each of these looks like a supply chain incident. Together, they're a campaign — and the pattern reveals something about where your AI stack is actually vulnerable.

---

## This Is a Dependency Graph Attack

TeamPCP isn't choosing targets at random. They're walking the dependency graph.

**Step 1: Compromise the scanner.** Trivy runs in CI/CD pipelines with elevated permissions — it needs to scan container images, pull registries, access build artifacts. When you compromise a scanner, you don't just get the scanner. You get every credential in the pipeline it runs in.

**Step 2: Use harvested credentials to compromise the framework.** The LiteLLM attack used credentials stolen from the Trivy compromise to authenticate against PyPI. The .pth backdoor in LiteLLM 1.82.8 then harvested *everything* — environment variables, SSH keys, AWS tokens, Kubernetes secrets, cloud configs, shell history — from every machine that installed the package.

**Step 3: Use *those* credentials to compromise the next target.** Researchers at Socket and Endor Labs [confirmed](https://www.aikido.dev/blog/telnyx-pypi-compromised-teampcp-canisterworm): if any developer or CI pipeline had both LiteLLM installed and access to the Telnyx PyPI token, that token was already in TeamPCP's hands. The Telnyx compromise was funded by the LiteLLM compromise, which was funded by Trivy.

This is cascading credential compromise. Each attack expands the credential pool for the next one. The dependency graph isn't just the attack surface — it's the attack map.

---

## What Makes Telnyx Different

The LiteLLM attack had a bug: a fork bomb that accidentally created 11,000 processes and alerted an engineer. The Telnyx attack doesn't have that bug. The attackers learned.

The payload, injected at line 459 of `telnyx/_client.py`, executes at import time. No `.pth` file this time — just malicious code in the main client module. But the exfiltration technique is what matters.

### WAV Steganography

Instead of embedding the malware payload directly, TeamPCP hides it inside audio files. The C2 server at `83[.]142[.]209[.]203` serves two WAV files — `hangup.wav` for Windows, `ringtone.wav` for Linux/macOS. The payload is XOR-obfuscated inside the audio frame data:

```python
with wave.open(wf, 'rb') as w:
    b = base64.b64decode(w.readframes(w.getnframes()))
    s, m = b[:8], b[8:]
    payload = bytes([m[i] ^ s[i % len(s)] for i in range(len(m))])
```

The file *is* a valid WAV file. The malicious content hides in the frame data. Content-based filtering won't catch it. URL allowlists for `.wav` files won't flag it. It's an audio file downloading an audio file — completely normal network behavior.

### Platform-Specific Persistence

**Windows:** Downloads `hangup.wav`, extracts an executable, drops it as `msbuild.exe` in the Startup folder. Runs silently on every login with a 12-hour re-drop cooldown.

**Linux/macOS:** A base64-encoded Python script fetches `ringtone.wav`, extracts the third-stage collector via the same XOR technique, runs it piped to stdin, then encrypts the harvest with AES-256-CBC and exfiltrates via HTTP POST.

The harvested data — credentials, environment variables, SSH keys, cloud configs, shell history — is compressed as `tpcp.tar.gz` and sent to the C2 server.

No fork bomb. No CPU spike. No 11,000-process alert. Just a quiet POST that looks like normal traffic.

---

## The Cascade Problem

Here's what makes this campaign structurally different from a one-off supply chain attack:

**Each compromise makes the next one easier.** Trivy gave TeamPCP CI/CD credentials. Those credentials unlocked LiteLLM's PyPI token. LiteLLM's reach — 95 million monthly downloads, present in 36% of cloud environments — gave them access to a massive pool of developer and pipeline credentials. Some fraction of those credentials grant publish access to other packages.

**The AI stack has an unusually dense dependency graph.** AI agents and frameworks pull in dozens of packages: LLM gateways, embedding models, vector stores, communication SDKs, monitoring tools, scanner integrations. Each of these packages has its own dependency tree. Each maintainer has credentials. Each CI/CD pipeline has tokens. The attack surface isn't linear — it's combinatorial.

**The credential layer is unprotected.** Every one of these attacks succeeds because credentials sit in the environment, accessible to any code running in the process. The scanner has pipeline tokens. The LLM framework has API keys. The communications SDK has cloud credentials. None of them are compartmentalized. None of them are audited. And when malware runs in the process, it takes everything.

This is the pattern: **walk the dependency graph, harvest credentials at each node, use them to move to the next node.** It's not a supply chain attack. It's supply chain *traversal*.

---

## Why Scanning Doesn't Stop This

The Trivy compromise is ironic in a specific way: Trivy is itself a security scanner. It's the tool you run to *find* vulnerabilities in your container images. TeamPCP compromised the scanner to gain access to the things the scanner was supposed to protect.

This reveals the fundamental problem with detection-first approaches to supply chain security. You can pin versions. You can use lockfiles. You can verify checksums. You can run scanners. But:

1. The scanner itself is a dependency with credentials.
2. Lockfiles don't help when the attacker has the maintainer's publishing token.
3. Checksums verify that you got what PyPI served — not that what PyPI served is safe.

Detection is necessary. It's not sufficient. When the attacker has legitimate publishing credentials, the malicious version *is* the version that passes verification.

---

## Vault-First Is an Architectural Defense

The reason each step in TeamPCP's campaign succeeds is the same: **credentials are in the environment, and the environment is accessible to all code running in the process.**

[AgentLair's vault model](https://agentlair.dev) removes credentials from the environment entirely. Instead of loading API keys, database passwords, and cloud tokens at startup, agents fetch credentials from an encrypted vault at the moment they're needed.

This changes the cascade dynamics in concrete ways:

**Credential harvest yields references, not credentials.** A compromised package running in a vault-first environment gets the agent's vault token — a single, scoped reference. Not the underlying API keys, SSH credentials, or cloud tokens. The attacker can't use a vault token to authenticate against PyPI, publish a backdoored package, or move laterally through the dependency graph.

**The cascade breaks.** TeamPCP's campaign works because each compromise expands the credential pool for the next attack. If the credentials aren't in the process, there's nothing to harvest. The dependency graph traversal stalls at the first vault-protected node.

**Every access is auditable.** When an agent fetches credentials from a vault, that access is logged — which agent, which credential, when. Anomalous patterns (a CI runner requesting production database credentials, or a burst of vault requests from a process that normally makes one) produce alerts. The LiteLLM attack was only detected because of a fork bomb bug. Vault-first architecture produces detection signals by design.

**Rotation is one operation.** When you suspect compromise — or when you see a blog post like this one — rotating credentials in a vault means changing one value, one time. Every agent and pipeline that references that credential gets the new value on its next fetch. Compare this to the current advice: "rotate all API keys, database credentials, and SSH keys from affected machines." All of them. Every machine. Good luck.

---

## What's Next

TeamPCP is [now partnering with the Vect ransomware group](https://www.infosecurity-magazine.com/news/teampcp-targets-telnyx-pypi-package/) to turn supply chain compromises into large-scale ransomware operations. The credential harvests aren't just funding the next supply chain attack — they're funding ransomware deployment.

The campaign has hit a scanner, an LLM framework, and a communications SDK in nine days. There's no reason to think it stops here. The dependency graph of the AI stack is large, the credential density is high, and most of it is unprotected.

**Immediate steps:**
1. Check for compromised packages: `pip show telnyx | grep Version` — if 4.87.1 or 4.87.2, assume compromise.
2. Check for `litellm` 1.82.7 or 1.82.8. Check Trivy versions from March 19 onward.
3. If affected: rotate *every* credential accessible from the compromised environment.
4. Pin dependencies. Use lockfiles. Verify that published versions match GitHub releases.

**Structural step:**
5. Move credentials out of the environment. A vault-based architecture doesn't prevent supply chain attacks — nothing does. But it stops the cascade. Each compromised node yields a scoped reference, not a credential pool that funds the next attack.

The question isn't whether your dependencies are trustworthy. At the scale of the AI dependency graph in 2026, they aren't. The question is what an attacker collects when they reach your process — and whether that collection funds their next target.

---

*AgentLair provides a credential vault and identity layer for AI agents. [agentlair.dev](https://agentlair.dev)*
