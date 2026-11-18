---
title: "LLM-42: Enabling Determinism in LLM Inference with Verified Speculation"
summary: LLM-42 makes LLM inference reproducible without batch-invariant kernels by decoding on the normal fast path and replaying windows of tokens under a fixed-shape reduction order, committing the tokens that match and rolling back the rest, so the cost is paid only by the requests that ask for determinism.
researchArea: Machine Learning Systems
keywords: llm inference, determinism, speculative decoding, batch invariance, gpu kernels, floating point, sglang
version: 1.0
updatedAt: 2026-11-18
---

## Overview

The same prompt can give different outputs across runs of an LLM server, even with identical sampling parameters. The cause is at the system level: floating-point addition is not associative, dynamic batching puts a request next to different neighbours on each run, and GPU kernels choose different reduction schedules for different batch sizes. Matrix multiplications, attention and normalization all reduce over many values, so a different schedule gives slightly different numbers, which can flip a token and, because decoding is autoregressive, change everything after it.

The current answer, adopted by SGLang and vLLM, is batch-invariant computation: every kernel uses one universal reduction strategy for every token, whatever the batch. This SOSP 2026 paper, from Microsoft Research and the University of Washington, argues that this is overconstrained. It strips kernels of optimizations such as split-K, it needs a parallel kernel stack kept only for determinism, and it makes determinism a global tax on every request in the batch.

Terms to keep apart: a reduction schedule is the order in which partial sums are combined, split-K is a GEMM technique that splits the reduction dimension across thread blocks, a batch-invariant kernel gives the same output for an input whatever the batch it sits in, and a position-invariant kernel gives the same output for an input whatever its position in a batch of the same total size.

Worth knowing first: the prefill and decode phases of LLM inference, continuous batching, the KV cache and speculative decoding (a fast path proposes several tokens and a verifier checks them). The KV cache is the subject of [PagedAttention](/papers/pagedattention-memory-management-for-llm-serving), the paper behind vLLM, which this paper cites in its related work and which, like SGLang, adopted batch-invariant mode. That pairing is mine.

## Contribution

- **Four observations.** O1: while a sequence is in a consistent state, the next token is mostly the same across runs, and divergence comes from the first flipped token being amplified by decoding. O2: most GPU kernels use shape-consistent reductions, the same strategy for every input of a given shape. O3: determinism only needs each token position to see the same reduction strategy across runs, not the same strategy for all positions. O4: real deployments need determinism for select tasks (evaluation, auditing, continuous integration), while creative workloads benefit from variability.
- **Decode-verify-rollback (DVR).** Tokens come from the normal fast path under dynamic batching. Periodically a verifier replays a fixed-size window of recent tokens in a separate forward pass. Because the input shape is fixed, the replay follows a consistent reduction order and serves as the reference. If every token matches, all are committed, plus one new token produced by the verifier. If one mismatches, only the tokens up to the last match are committed, with the verifier's next token, and the rest are recomputed. Tokens reach the user only after verification.
- **KV cache repair.** The verifier overwrites the KV cache entries written during fast-path decoding with its own, so later steps start from a consistent state. Each verification pass commits at least one token, so progress is guaranteed even if every speculated token were rejected.
- **Prefill handled by construction.** Prefill is made deterministic by not batching its tokens arbitrarily, so only decode tokens need a verifier. The window padding with dummy tokens covers sequences that end mid-window.
- **Grouped verification.** A small window is memory-bound and expensive per token, a large window is cheap per token but recomputes more on a mismatch. The paper verifies small fixed windows of several requests in one pass (for example 8 requests of 32 tokens), keeping the rollback cost of a small window and the utilization of a large batch.
- **Selective determinism.** A per-request flag, `is_deterministic`, defaults to false, so only flagged requests pay for verification. The authors implement LLM-42 on SGLang and reuse its GEMM, RMSNorm and fused-MoE kernels, with FlashAttention-3 and one KV split in the verifier, multimem-based AllReduce where available, and SGLang's seeded sampler (`multinomial_with_seed`).

## Methodology

The cost of the baseline is measured first. Batch-invariant Triton kernels are compared with cuBLAS for a Llama-3.1-8B-Instruct feed-forward down projection, and three RMSNorm implementations are compared, then an end-to-end decode scenario with 10 and 11 requests. To test O1, 350 ShareGPT requests run first at batch size one to get reference outputs, then again under dynamic batching at 6 queries per second with 512 output tokens, and each is scored by the length of its first and second consistent spans.

The evaluation uses Llama-3.1-8B-Instruct on a machine with four NVIDIA H100 PCIe GPUs (80 GB each), SGLang 0.5.3rc0 and FlashAttention-3. Offline inference runs 4096 requests on each of eight workloads: the ArXiv and ShareGPT datasets, plus six synthetic input and output length pairs. Online inference replays 4096 ShareGPT requests at 12 to 18 queries per second and reports end-to-end latency and time to first token (TTFT). The share of deterministic requests is 2%, 5%, 10%, 20%, 50% or 100%. Baselines are SGLang in its deterministic mode and in its non-deterministic mode, the latter as a ceiling. An ablation varies the verification window from 16 to 512 tokens and the number of requests verified together from 1 to 32.

## Findings

These are the authors' reported results.

- **Batch invariance is costly.** The batch-invariant GEMM peaks at 194 TFLOPS against 527 for cuBLAS (63% lower), because it uses no split-K or newer hardware features. The Python RMSNorm used in SGLang is up to 7 times slower than the default CUDA kernel, and the Triton one up to 50% slower.
- **One deterministic request slows everyone.** With 10 non-deterministic requests SGLang decodes 845 tokens per second, and 931 with an eleventh. If that eleventh request is deterministic, the whole batch runs through the slow kernels and throughput falls 56% to about 415. LLM-42 reaches 911 tokens per second in the same case, 2.2 times SGLang's deterministic mode and within 3% of the non-deterministic one.
- **Divergence is late, then fast.** Under dynamic batching many requests match the reference for hundreds of initial tokens, some for all 512, but after the first divergence the second consistent span is near zero for most requests.
- **Offline throughput.** SGLang's deterministic mode loses 24% (in=2048, out=512) to 36% (ShareGPT). At 100% deterministic traffic LLM-42 is still faster in all but one setting, where it is 6% slower (ShareGPT). On ArXiv it stays within 8%, 2%, 1% and 1% of the non-deterministic ceiling at 5%, 10%, 20% and 50% deterministic traffic, up to 41% faster than SGLang's deterministic mode, and 33% faster on ShareGPT at 10% (up to 48% on one synthetic setting).
- **Rollbacks are rare.** More than half of requests finish with no rollback. In the worst case (ArXiv, 100% deterministic) there are 3351 rollbacks over 4096 requests, fewer than one per request, and the recomputed share peaks at 10.97%. Some configurations see none.
- **Online latency.** At 12 queries per second SGLang's deterministic mode has median latency 4.64 s and P99 28 s, against 2.15 s and 13.2 s non-deterministic. At 18 it is 10.6 s and 71.1 s against 2.84 s and 17.4 s. LLM-42 at 2% deterministic traffic has a median of 2.21 s at 12 queries per second, 3% above the ceiling, and at 100% deterministic traffic its P90 TTFT at 18 queries per second is 101.2 ms against 171.6 ms.
- **Window ablation.** Without grouping, P99 latency is 615 s at a window of 16 tokens, 56.18 s at 128 and 99.94 s at 512. Verification costs up to 0.75 ms per token for small windows and 0.05 ms at 512, while recomputation rises from 6.81% at 32 tokens to 46.41% at 256. Grouped verification brings the best configurations (256 tokens per step over 4, 8 or 16 requests) to a P99 of 34 to 35 s.

## Critical Analysis

The paper states several limits itself.

- **Verification pauses everyone.** In the prototype a verification pass stalls all in-flight requests, so even selective determinism adds latency to the rest, and prefill is not batched. With low load and mostly deterministic traffic, LLM-42 is slower than SGLang's deterministic mode.
- **No prefix sharing.** Prefill and decode use different reduction strategies, so the system is not prefill-decode invariant and cannot share prefix caches across turns or requests. It does not combine with speculative-decoding inference either.
- **Multi-GPU not measured.** Correctness was checked on Qwen-4B-Instruct-2507, Qwen3-14B and Qwen3-30B-A3B-Instruct-2507 and on 1 to 4 GPUs with tensor parallelism, but performance is reported only for one model, and the test machine lacks multimem/NVLS.

The following points are a reading of the evidence, not claims of the paper.

- **The guarantee rests on an assumption about kernels.** O2 says reductions depend on shape only, and the verifier is deterministic if that holds. The paper shows which common operators have the property (its Table 2 marks ring-based AllReduce as neither batch- nor position-invariant) and fixes configurations for attention and AllReduce, but gives no proof or test that a new kernel or library version keeps it. Determinism here also means across runs on the same stack, not across GPU types or software versions.
- **One model, one baseline.** Throughput and latency come from Llama-3.1-8B on H100 and are compared with SGLang's batch-invariant mode only. vLLM's mode and faster batch-invariant kernels are not measured, and the authors themselves note that the Triton kernels they compare against omit split-K.
- **The traffic mix is chosen.** The result that overhead tracks the deterministic share depends on a real deployment having a small share. The ratios from 2% to 100% are the authors' sweep, not a measured production mix, and the whole case rests on O4.
- **Online recomputation is higher than offline.** The paper reports above 6% online against under 2% offline and attributes it to batch-size variability, which suggests that bursty production load sits nearer the online numbers.
- **Not an end-to-end user story.** Tokens are released only after verification, which delays them, and the paper reports TTFT but not inter-token latency or streaming behaviour.

## Further Research

- Moving verification off the critical path, for example by confining it to a subset of GPU SMs or deferring verification batches behind regular prefill and decode, which the authors name.
- Making prefill and decode share one reduction strategy so that prefix caches can be shared, and combining DVR with speculative-decoding inference.
- Measuring multi-GPU performance on hardware with multimem AllReduce and checking the guarantee across GPU generations and library versions.
- Comparing against vLLM and optimized batch-invariant kernels, and measuring what share of real traffic asks for determinism.
