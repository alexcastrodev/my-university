---
title: "Hints for Computer System Design"
summary: Lampson distills his experience with the Alto, Ethernet, Pilot, Bravo and other Xerox PARC systems into a set of informal slogans ("keep it simple", "cache answers", "use hints", "log updates", "end-to-end") arranged by what they buy a system (functionality, speed, fault-tolerance) and where in the design they apply. He calls them hints, not laws.
researchArea: Operating Systems
keywords: system design, interfaces, simplicity, caching, hints, end-to-end argument, logging, atomic actions
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Studying the design and implementation of a number of computer systems has led to some general hints for system design. They are described here and illustrated by many examples, ranging from hardware such as the Alto and the Dorado to application programs such as Bravo and Star.

## Overview

Butler Lampson presented this paper at the Ninth ACM Symposium on Operating Systems Principles (Bretton Woods, October 1983), and it appeared in Operating Systems Review 15(5), pages 33 to 48. The text I read is the author's own slightly revised copy of that version. The author, at the Xerox Palo Alto Research Center, says he has "designed and built a number of computer systems, some that worked and some that didn't", and says up front that "I claim no originality for them; most are part of the folk wisdom of experienced designers." It opens by contrasting system design with algorithm design: the requirement is less precisely defined, there is much more internal structure, and the measure of success is unclear.

Each hint comes with a slogan. Figure 1 sorts the slogans on two axes: why it helps (functionality, "does it work?", speed, "is it fast enough?", fault-tolerance, "does it keep working?") and where it helps (completeness, interface, implementation). Sections 2, 3 and 4 follow the three "why" columns. The paper also says it avoids "exhortations to modularity" and methodologies for top-down or bottom-up design.

Worth knowing first: what an interface is, how a file system and a virtual memory system work, and what a cache is. The catalog pairings below are mine, the 1983 paper cannot cite them. [The UNIX Time-Sharing System](/papers/unix-time-sharing-system) is the system behind the "do one thing well" example (the paper cites the 1978 Bell System Technical Journal version, not this 1974 one). [Access Path Selection](/papers/system-r-access-path-selection) is from the System R project whose recovery manager Lampson cites for logging. For logs, caches and failure at Google and Amazon scale, see [The Google File System](/papers/google-file-system), [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) and [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store). A neighbor in design-principles style is [The Protection of Information in Computer Systems](/papers/protection-of-information-in-computer-systems).

## Contribution

- **A classification, not a theory.** The slogans are placed in a two-axis table (Figure 1). Repeated slogans (for example end-to-end, cache answers, use hints, make actions atomic) appear in more than one cell.
- **Functionality.** Interfaces come first, and the paper calls defining them "the most important part of system design". It asks that an interface be simple, complete and implementable small and fast. Hints here: do one thing at a time and do it well, don't generalize, get it right, make it fast rather than general or powerful, don't hide power, use procedure arguments, leave it to the client, keep basic interfaces stable, keep a place to stand, plan to throw one away, keep secrets, divide and conquer, use a good idea again.
- **Handling all the cases.** Handle normal and worst cases separately: the normal case must be fast and the worst case must make some progress.
- **Speed.** Split resources in a fixed way, use static analysis if you can, use dynamic translation, cache answers, use hints, use brute force when in doubt, compute in background, use batch processing, safety first, shed load.
- **Fault-tolerance.** End-to-end error recovery is the logically necessary part and lower levels are "strictly for performance". Log updates as the record of truth, and make actions atomic or restartable.
- **Hints versus caches.** A hint is a saved result that may be wrong and is not necessarily found by associative lookup, so it must be checked against the "truth" before any unrecoverable action.

## Methodology

There is no experiment. The method is argument by example: each slogan is explained in a paragraph or two and tied to systems the author knew well, with references for nearly all the specific examples and few for the ideas themselves. The examples come from hardware (Alto, Dorado, Ethernet), operating systems (SDS 940, Alto OS, Pilot, Tenex, Cal), programming systems (Lisp, Mesa, Interlisp-D, Cedar, Smalltalk), applications (Bravo, Star) and servers (Dover printer, Grapevine, Juniper). Quotations from Hamlet, mostly Polonius' advice to Laertes, head the hints.

The paper lists what it is not: not novel (with a few exceptions), not foolproof recipes, not laws of system design, not precisely formulated, not consistent, not always appropriate, not approved by all leading experts and not guaranteed to work.

## Findings

The paper reports no measurements of its own, so these are the claims and figures it quotes.

- **Interface cost.** If six levels of abstraction each cost 50% more than is "reasonable", the service at the top misses by more than a factor of 10. The Alto file system (about 900 lines) and paging system (about 500 lines) are small and fast, while Pilot, which maps virtual pages to file pages, is about 11,000 lines and often needs two disk accesses per page fault.
- **Tenex.** A system call that passes the password by reference and reports unassigned pages to the user lets an attacker find an n character password in 64n tries on average rather than 128n/2.
- **Fast and simple.** machines such as the 801 and the RISC, with fast simple instructions, can run programs faster than machines with more general instructions, and one set of measurement tools sped up Interlisp-D by a factor of 10. The paper says it is normal for 80% of the time to be spent in 20% of the code.
- **Normal and worst case.** "One crash a week is usually a cheap price to pay for 20% better performance", provided error recovery is decent. Cedar treats every local variable as a possible pointer, and measurements show that less than 1% of the storage is incorrectly retained.
- **Hints in practice.** Alto and Pilot disk labels, Arpanet routing tables, Ethernet carrier sense and exponential backoff, and Smalltalk method lookup, where the cached type is right about 96% of the time.
- **Resources.** A system "cannot be expected to function well if the demand for any resource exceeds two-thirds of the capacity, unless the load can be characterized extremely well". Cleverness in scheduling and paging has mostly failed, and the exception is well-known loads such as the 360/50 APL system.
- **End-to-end.** To trust a file copy, check a checksum of the bits on the destination disk against the source. At Cambridge a 58 MByte disk pack is copied with only an end-to-end check, since errors are rare enough that the 20 minutes of work seldom repeats.
- **Logs and atomicity.** Log entries must be re-executable, with functional update procedures and value arguments (Bravo has two update functions, Replace and ChangeProperties). Storing values into variables is restartable and incrementing is not. Grapevine uses time-stamped updates where the latest wins, a weaker and cheaper alternative to atomic actions.

What the paper does not claim: that the hints are rules, that any of them was tested against alternatives, that the techniques are free of cost (it names the conflicts itself), or anything about networks of the scale that came later.

## Critical Analysis

- **Anecdotal evidence, by design.** Statements such as "this has never worked" for after-the-fact disk optimization carry the qualifier "as far as I know", and the reasons paging beat segments are called "complex and not systematically studied". Numbers like the two-thirds capacity limit are experience, not measurement.
- **Slogans pull against each other.** Keeping secrets conflicts with not hiding power, and the paper says so. The author warns that hints are "not consistent" and "many are controversial", so the judgment of when each applies is left to the reader.
- **A dated hardware context.** The examples assume machines with 16 registers, 64 ns memory cycles (Dorado), disk labels and hardware the designer controlled. The hints survive better than the numbers.
- **Self-critical examples.** The author says in retrospect that the Dorado's high I/O bandwidth was probably not worth the cost, and that Pilot's extra functionality was bought at a high price.
- **Citation slip.** The text cites the Pup internet as reference [4], which in the list is the APL/360 paper; Pup is [3].
- **Literature after 1983 (not in this paper).** Saltzer, Reed and Clark, "End-to-end arguments in system design" (ACM Transactions on Computer Systems 2(4), November 1984, checked on Crossref), is the journal version of the idea the paper credits to Saltzer's 1981 conference paper. Lampson also published a version of this paper in IEEE Software 1(1), January 1984, pages 11 to 28 (checked on Crossref, not read), and the same author later posted "Hints and Principles for Computer System Design" (arXiv 2011.02455, November 2020; title and date checked on arXiv, not read here). In this catalog, the Dynamo paper uses "hinted handoff" for a different mechanism than the checkable hints described here, which shows how the word travels.

## Further Research

- Measure the hints: for each slogan, find systems where following it paid off and systems where it did not, instead of relying on recollection.
- Study where the end-to-end check is cheap and where it is not, since the paper names the need for "a cheap test for success" as a limit, together with performance defects that appear only under load.
- Revisit "compute in background", "batch processing" and "shed load" for modern data-center services, comparing with [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) and with [Metastable Failures](/papers/metastable-failures-in-distributed-systems), on feedback loops that keep a system overloaded.
- Read the paper's logging and atomic action sections next to [Paxos Made Live](/papers/paxos-made-live-engineering-perspective) and [Viewstamped Replication Revisited](/papers/viewstamped-replication-revisited), which replicate the log that Lampson treats as a single local structure.
- Compare each hint with the later literature that names the same idea, starting with the 1984 end-to-end paper and the 2020 essay by the same author.
