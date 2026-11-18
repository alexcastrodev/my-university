---
title: "TensorDex: A Compact, Tensor-Centric Storage System for Modern AI Models"
summary: TensorDex stores fine-tuned language models losslessly by delta-compressing each tensor against the most similar tensor from any earlier model, found through an 8 KB bit-level sketch, a regressor that predicts compressibility and an incremental clustering algorithm, and cuts a sampled Hugging Face corpus by 70.5% without needing model-card lineage.
researchArea: Machine Learning Systems
keywords: model storage, delta compression, tensors, lossless compression, deduplication, clustering, hugging face
version: 1.0
updatedAt: 2026-11-18
---

## Overview

Model hubs keep a growing pile of large language models. The cumulative storage of Hugging Face, models and datasets together, went from 0.28 PB in 2023 to over 76 PB at the end of 2025, and most of it is fine-tuned derivatives: by 2025 they account for 99.1% of the storage and 99.6% of the models. A fine-tune differs only slightly from its parent yet occupies the full model size, so the obvious saving is delta compression: store a base model once and, for each variant, only the compressed difference.

The authors argue that delta compression breaks down at hub scale for three reasons. Lineage is missing: of 2,751,212 Hugging Face repositories in March 2026 only 25.8% carry usable base-model metadata, and for the coldest models the missing rate is above 88%, and the metadata is often copied or edited incorrectly. The choice of base is decisive: on five Qwen2.5-3B variants, pairing each with the pre-trained base gives 29% reduction while the empirically best base per model gives 47%. And the right unit is the tensor, not the model: embeddings, attention projections and MLP layers drift differently during fine-tuning, so the best base for one tensor of a model often lives in a different model from the best base for another. The state-of-the-art system they compare against, ZipLLM, relies on model cards and pairs whole models, and falls back to brute-force bit-distance search when the card is missing, which costs I/O quadratic in the size of the hub.

This SOSP 2026 paper, a Distinguished Artifact Award winner, presents TensorDex as a lossless, tensor-centric storage system that finds the pairing from the data itself.

Terms to keep apart: a base tensor is stored in full and a delta tensor is stored as a compressed difference against exactly one base, the reduction ratio is the fraction of bytes saved on a tensor or a set of tensors, normalized Hamming distance is the fraction of bits that differ between two tensors, and a cluster is a base plus the tensors delta-compressed against it.

Worth knowing first: how fine-tuning changes weights only slightly, what XOR-based delta coding and entropy coding do to bytes that are mostly equal, the structure of the safetensors file format, and the idea of approximate nearest-neighbor search with HNSW.

## Contribution

- **TensorID and TensorSketch.** Every tensor gets a 16-byte xxHash128 over its raw bytes for exact deduplication and a TensorSketch fingerprint for similarity. TensorSketch is a CountSketch built on bits instead of values: each bit position of each element is hashed into a bucket with a sign, so the sketch tracks bit-level divergence, which is what delta compressibility depends on. With depth 2 and width 1,024 of 32-bit counters it takes 8 KB per tensor, and the Hamming distance between two tensors is estimated as the median, over the rows, of the squared L2 norm of the sketch difference.
- **TensorPred.** A small regression predicts the reduction ratio of a tensor pair from the estimated normalized Hamming distance, from its binary entropy and from their product, with coefficients fitted offline. This closes the gap between similarity and compressibility, since two tensors close in L2 can still give a poorly compressible delta.
- **FlexSplit.** An incremental, two-phase clustering algorithm that approximates the NP-hard facility-location problem of picking bases. Phase I attaches each arriving tensor to the existing base with the highest predicted reduction, or starts a new cluster for an unseen shape and name, using an HNSW index over sketches. Phase II revisits clusters, takes members whose predicted reduction is well below the cluster average as split candidates, and promotes one to a new base only when the net gain is positive, reassigning the members that improve. Splitting is local to a cluster, and each delta references exactly one base, so restoring a tensor reads one base and one delta.
- **Pluggable codecs.** TensorX extends ZipLLM's BitX with chunk-level parallelism and byte-plane separation, aimed at throughput. FM++ extends FM-Delta with native BF16 support and chunk-level parallelism, raising its speed from about 100 MB/s to 9,821 MB/s, aimed at reduction. Planning is decoupled from the codec.
- **Implementation.** About 12K lines of Python and 3K lines of C and Rust with SIMD/AVX2 kernels, a PostgreSQL metadata store, an HNSW index and a safetensors-compatible blob format extended with compression flags. Deletion is deferred: a tensor is tombstoned and, if it is a base with live dependents, a later offline transaction promotes another cluster member and recompresses the dependents. The code is public (ds2-lab/TensorDex).

## Methodology

The dataset reconstructs the random trace used by ZipLLM: 2,890 models with 961,509 tensors (44.86 TB), sampled within eight representative fine-tuned families (Qwen2.5, Qwen3, Mistral, Llama-3, 3.1 and 3.2, Gemma-2 and Gemma-3) rather than across the whole hub. Exact deduplication by TensorID leaves 741,689 unique tensors (40.11 TB), and every reduction ratio in the paper, including the headline, is measured against that post-deduplication size. Models are ingested in creation order to mimic a hub receiving uploads continuously.

Experiments run on one Amazon EC2 c6a.48xlarge (96-core, 192-thread AMD EPYC 7R13, 384 GB of DRAM), with all data in memory for throughput and with Amazon S3 and a provisioned EBS gp3 volume for the real-storage retrieval test. The planner baselines are ZipLLM and a default that groups models by model-card family and applies FM-Delta, with metadata randomly given to 25.8% of models to mirror reality and ZipNN as the fallback. The codec baselines are BitX, vanilla FM-Delta, ZipNN, zstd and OpenZL. Similarity search is compared against exact bit distance, HNSW over raw tensor bytes, locality-sensitive hashing and a 2048-dimension random projection. The base-selection solver is compared against the Gurobi integer linear program and a primal-dual approximation on up to 800 Qwen2.5-7B tensors.

## Findings

These are the authors' reported results.

- **Storage.** TensorDex-FM++ reduces the corpus by 70.5% and TensorDex-TX by 65.1%, against 53.4% for ZipLLM and 37.1%, 33.3% and 21.9% for FM-Delta, ZipNN and OpenZL alone. The headline "37% lower than the state of the art" is the footprint left, about 29.5% of the deduplicated size against 46.6%. Reduction keeps rising as more models arrive, with no sign of saturation, while ZipLLM plateaus.
- **Attribution.** With a comparable codec, the planner alone moves 53.4% to 65.1% (ZipLLM against TensorDex-TX), and swapping TensorX for FM++ over the same pairs adds 5.4 points. The largest per-family gaps, 20 to 25 points, are on Qwen2.5, Mistral-v0.1 and Gemma-3, where ZipLLM falls below 50% and TensorDex-FM++ stays above 65%.
- **Throughput.** With all data in memory and 192 threads, TensorDex-TX ingests at 22,916 MB/s and retrieves at 28,393 MB/s, against ZipLLM at 5,942 and 7,981 and OpenZL at 753 and 19,068. These are the 3.86 times and 1.49 times in the abstract. TensorDex-FM++ gets 9,821 and 8,494 MB/s.
- **Real storage.** Retrieval from S3 and EBS runs at 1.96 to 4.26 GB/s, 3 to 4.5 times below the in-memory figure, so it is I/O-bound and decompression is not the bottleneck. Read amplification is 1.2 to 1.4 times, median 1.27 times.
- **Metadata.** TensorID and TensorSketch for all 741,689 unique tensors take about 6.1 GB, 0.015% of the stored data.
- **TensorSketch.** Recall@1 is about 1.00 on Qwen, Llama and Gemma, against 0.60 to 0.77 for raw-tensor HNSW and LSH and 0.32 to 0.41 for random projection. It sustains over 25,000 queries per second (500 to 800 times raw-tensor HNSW, up to 20,082 times exact bit distance) and cuts per-query I/O from about 35 MB to 8 KB. HNSW over the sketches reaches Recall@1 of 0.9986 against exact search and gives the same FlexSplit outcome (65.1%, 6,482 bases) while clustering 3.8 times faster.
- **TensorPred.** On 5.7M held-out pairs the Pearson correlation is 0.993, with a mean absolute error of 1.11%, median 0.79%, P90 2.32% and P99 6.03%. Trained on Qwen and Llama and tested on unseen Gemma and Mistral, the error rises only from 0.0230 to 0.0265 and the correlation is 0.978 against 0.977.
- **FlexSplit.** Solve time stays almost flat from 100 to 800 tensors while the ILP exceeds 70 seconds at 800 and primal-dual grows linearly, with reduction within a few points of the ILP optimum. In the full corpus, 58.9% of clusters need no split, and across 1,352 split clusters 98.8% improve, median 0.469 to 0.650.

## Critical Analysis

The paper states several limits itself.

- **A sample inside popular families.** The trace is drawn randomly within eight fine-tuned families, not across the hub, and the authors say so.
- **Compatibility conditions.** A delta and its base must share dtype, and a tensor with an unseen shape and name starts its own cluster as a base. LoRA adapters and quantized checkpoints are treated as ordinary tensor sets, with full-weight fine-tunes and checkpoints the dominant storage.
- **Retrieval is I/O-bound in practice.** The authors report this themselves from the S3 and EBS test.

The following points are a reading of the evidence, not claims of the paper.

- **The headline mixes two configurations.** The 70.5% reduction is TensorDex-FM++, while the 22.9 GB/s and 28.4 GB/s belong to TensorDex-TX, which reaches 65.1%. FM++ ingests at 9,821 MB/s, 1.65 times ZipLLM, and retrieves at 8,494 MB/s, only 1.06 times. Also, the "next-best system" is ZipLLM for ingestion and OpenZL for retrieval, and OpenZL saves just 21.9%, so the retrieval speedup is against a compressor that saves one third as much.
- **Throughput is a ceiling, not an experience.** The in-memory numbers use all 192 threads of a large instance, and on real storage the retrieval rate falls to a few GB/s, which a faster decoder does not improve. The case for the system is then the storage saved, and the paper does not translate it into cost.
- **Dedup is outside the headline.** The 70.5% is measured after exact deduplication already removed about 10.6% of the bytes (44.86 TB to 40.11 TB), so the end-to-end saving against the raw corpus is larger, and the comparison systems get the same starting point.
- **Maintenance costs are not shown.** Phase II re-attaches members to new bases and deleting a base recompresses its dependents, and the text I read measures neither, nor the effect of long-lived churn such as many deletions on a hub. The trace is ingested once in creation order.
- **Optimality is checked only at small scale.** The comparison with the ILP covers up to 800 tensors of two types, while the corpus has 741,689, so the near-optimal claim is shown on a slice. The held-out test for TensorPred does cover unseen families.
- **Fairness of the metadata baseline.** The text I read does not say how much lineage metadata ZipLLM got in the comparison, and ZipLLM's reported weakness is largest where lineage is absent, so the gap depends on that assumption.

## Further Research

- Planning across the whole hub, not within a few families, including architectures with no earlier relative, and mixing lossless deltas with lossy techniques where users accept them.
- Measuring the cost of continuous operation: recompression after splits and deletions, index growth, and the effect on tail latency of model downloads.
- Placing popular bases in a cache or a faster tier to cut read amplification, which the authors suggest.
- Extending the same tensor-level view to datasets, optimizer state and intermediate training checkpoints, which production pipelines often keep in full.
