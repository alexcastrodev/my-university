---
title: "Efficient Memory Management for Large Language Model Serving with PagedAttention"
summary: Applies operating-system paging to the key-value cache of LLM serving, nearly removing wasted GPU memory and letting requests share cache blocks.
researchArea: Machine Learning Systems
keywords: llm serving, kv cache, virtual memory, paging, gpu memory
version: 1.1
updatedAt: 2026-10-31
---

## Abstract

High throughput serving of large language models (LLMs) requires batching sufficiently many requests at a time. However, existing systems struggle because the key-value cache (KV cache) memory for each request is huge and grows and shrinks dynamically. When managed inefficiently, this memory can be significantly wasted by fragmentation and redundant duplication, limiting the batch size. To address this problem, we propose PagedAttention, an attention algorithm inspired by the classical virtual memory and paging techniques in operating systems. On top of it, we build vLLM, an LLM serving system that achieves (1) near-zero waste in KV cache memory and (2) flexible sharing of KV cache within and across requests to further reduce memory usage. Our evaluations show that vLLM improves the throughput of popular LLMs by 2-4x with the same level of latency compared to the state-of-the-art systems, such as FasterTransformer and Orca. The improvement is more pronounced with longer sequences, larger models, and more complex decoding algorithms. vLLM's source code is publicly available at https://github.com/vllm-project/vllm.

## Overview

Serving a large language model to many users at once needs large batches, and the batch size is limited by GPU memory. A big share of that memory goes to the key-value (KV) cache, which holds the attention state of every token of every request, and which grows and shrinks as each request generates text.

This SOSP 2023 paper observes that existing systems manage that memory badly, wasting it to fragmentation and duplication, and borrows an idea from operating systems to fix it.

## Contribution

The paper contributes two things.

- **PagedAttention**, an attention algorithm that works on a KV cache stored in non-contiguous fixed-size blocks, like pages in virtual memory.
- **vLLM**, a serving engine built on it, with block-level memory management, preemptive scheduling and distributed execution, that wastes almost no KV cache memory and shares blocks within and across requests.

## Methodology

The authors first measure how much KV cache memory existing systems waste. They find three sources: reserved space for tokens not yet generated, internal fragmentation, and external fragmentation.

vLLM keeps a block table per request that maps logical blocks to physical blocks, allocates blocks only as tokens are generated, and uses copy-on-write for blocks shared between sequences, such as in parallel sampling and beam search. When memory runs out it can preempt requests, either by swapping blocks to CPU memory or by recomputing them.

The evaluation compares vLLM with FasterTransformer and Orca on several models and workloads.

## Findings

These are the authors' reported results.

- In existing systems, only 20.4% to 38.2% of the KV cache memory stored actual token states, while vLLM used 96.3%.
- vLLM improves the throughput of popular LLMs by 2 to 4x at the same level of latency compared to FasterTransformer and Orca.
- The improvement is larger with longer sequences, larger models and more complex decoding algorithms.
- The paper reports this without affecting the model's accuracy, and the source code is public.

## Critical Analysis

The analogy to paging is useful because it is concrete: the block table, copy-on-write and swapping all have a direct operating-system counterpart, and the source code is public.

Points to read carefully:

- The gains depend on workloads where memory, not compute, limits the batch size. With short sequences or small models the gap narrows.
- Reading from non-contiguous blocks has a cost: the authors measure 20% to 26% higher attention kernel latency than FasterTransformer, and argue it is small because it affects only the attention operator. The block size is a trade-off between hardware utilization and fragmentation.
- The comparison is against the systems of the time (FasterTransformer, Orca), and the field moves quickly, so newer baselines may narrow it.
- Swapping and recomputation as ways to preempt have a cost that depends on the hardware link and the model.

## Further Research

- Sharing KV cache blocks across requests with common prefixes, and policies for which blocks to keep.
- Better scheduling and preemption policies under memory pressure.
- Extending the approach to other accelerators and to models whose attention state is not a plain KV cache.
- Interactions between paging, quantization and speculative decoding.
