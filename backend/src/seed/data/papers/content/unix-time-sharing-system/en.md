---
title: "The UNIX Time-Sharing System"
summary: Ritchie and Thompson describe UNIX on the PDP-11/40 and 11/45: a small, interactive, self-hosting system built around a uniform file abstraction (ordinary files, directories and special files), i-nodes, fork, exec and pipes, and a user-level Shell.
researchArea: Operating Systems
keywords: unix, time-sharing, file system, i-node, fork and exec, pipes, shell, pdp-11
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

UNIX is a general-purpose, multi-user, interactive operating system for the Digital Equipment Corporation PDP-11/40 and 11/45 computers. It offers a number of features seldom found even in larger operating systems, including: (1) a hierarchical file system incorporating demountable volumes; (2) compatible file, device, and inter-process I/O; (3) the ability to initiate asynchronous processes; (4) system command language selectable on a per-user basis; and (5) over 100 subsystems including a dozen languages. This paper discusses the nature and implementation of the file system and of the user command interface.

## Overview

This is the 1974 Communications of the ACM paper by Dennis Ritchie and Ken Thompson of Bell Laboratories, a revised version of their talk at the Fourth ACM Symposium on Operating Systems Principles (October 1973). It is the first public description of UNIX, and it is short: the interface it describes (open, read, write, fork, exec, pipe, the Shell) is still recognizable in every Unix-like system today.

The paper covers the PDP-11 version only. It says there were three versions of UNIX: one on the PDP-7 and PDP-9 (circa 1969 to 1970), one on the unprotected PDP-11/20, and the one described, on the PDP-11/40 and /45. By the time of writing about 40 installations existed, mostly smaller than the authors' own, used for things like preparing patent applications and processing trouble data from Bell System switching machines.

Worth knowing first: what a file system, a process and a system call are, and how a command line interpreter works. Many of the ideas here show up again in catalog papers that rethink one layer of this design: [μFork](/papers/ufork-posix-fork-within-a-single-address-space-os) is about what `fork` costs in an operating system without separate address spaces, and [Oxbow](/papers/oxbow-coordinated-architecture-for-multi-component-file-systems) and [Trio](/papers/trio-high-performance-and-secure-userspace-nvm-file-systems) ask where file system code should run. These pairings are mine, the 1974 paper cannot cite them.

## Contribution

- **One file abstraction for three things.** There are ordinary files (an unstructured string of bytes, with structure left to the programs that use them), directories, and special files. Each I/O device has at least one special file, in the directory `/dev`, read and written like a disk file, so device names and file names have the same syntax and the same protection.
- **Directories as a tree with links.** A path name is a sequence of names separated by slashes; names are 14 characters or fewer. The same file may appear in several directories (a link) and all links have equal status, so a file exists independently of any directory entry. Directories are constrained to a rooted tree, with the entries `.` and `..`.
- **I-nodes.** A directory entry holds only a name and an i-number, an index into the i-list stored on the device. The i-node holds owner, protection bits, block addresses, size, time of last modification, link count and bits for directory, special and large file.
- **Processes from fork, exec, wait and exit.** A new process comes only from `fork`, which splits the caller into two copies that share open files. `execute` replaces the code and data of the calling process from a file while keeping open files and the current directory.
- **Pipes and standard I/O.** Programs start with file descriptors 0 and 1 open. The Shell redirects them with `<` and `>`, and connects commands with `|` through a pipe, so a program need not know whether it reads a file, a terminal or another program.
- **A Shell that is just a program.** It reads a line, calls `fork`, the child calls `execute`, and the parent waits. A command ending in `&` simply is not waited for.
- **Protection by user ID and a set-user-ID bit.** Seven protection bits per file, plus a super-user exempt from them.

## Methodology

This is a system description, not an experiment. The authors explain the user-visible interface (section 3), its implementation (section 4), the process model (section 5) and the Shell (section 6), then add a short perspective on the design and a statistics section about their own installation. The only measurement of the system itself is one timing run, the assembly of a 7621-line program, run alone on the machine. Section 9 reports usage figures from the Murray Hill machine, a 144K byte PDP-11/45, with no description of how they were collected.

## Findings

All numbers below are from the paper.

- **Cost and size.** UNIX can run on hardware costing as little as $40,000, and less than two man years went into the main system software. On the authors' PDP-11/45 (16-bit words, 144K bytes of core) UNIX occupies 42K bytes, including many device drivers and generous buffers and tables. A minimal system capable of running the software they list can need as little as 50K bytes of core in all.
- **Rewritten in C.** The system was rewritten from assembly language to C during the summer of 1973. The new system is about one third larger, which the authors consider acceptable because it is easier to understand and modify and adds multiprogramming and sharing of reentrant code.
- **File layout.** Disk space is divided into 512-byte blocks. Each i-node has room for eight device addresses. A small file fits in eight or fewer blocks. In a large file each of the eight addresses points to an indirect block of 256 addresses, so a file may reach 8 x 256 x 512 = 1,048,576 (2 to the power 20) bytes. A special file's i-node instead holds a device type and a subdevice number. Opening a file turns the path name into an i-number by searching directories. The root directory has i-number 1 on every file system, and `mount` is a table that substitutes the root of a removable volume for an ordinary file.
- **Links and the tree.** Making a link copies the i-number and increments the link count. Deleting decrements it, and at zero the blocks are freed and the i-node deallocated. No link may cross file systems, and in the root of every file system `..` refers to the directory itself. The authors give a reason for forbidding links to directories: it would be hard to detect when the last connection from the root to a directory was cut.
- **Consistency and a cost of the design.** A consistency check needs only a scan of the linear i-list, independent of the directory hierarchy. But with equal-status links it is unclear who is charged for a file's space; the authors say the current version avoids the issue by not charging any fees.
- **No locks.** There are no user-visible locks. The authors argue locks are unnecessary, since they have no large single-file databases, and insufficient, since an editor that works on a copy defeats them.
- **Pipes are limited.** The paper says a pipe is not completely general, because it must be set up by a common ancestor of the processes involved. A forked child inherits the open files of its parent, and the Shell implements `<` and `>` by closing descriptor 0 or 1 and opening the named file, since the smallest unused descriptor is assigned.
- **Efficiency.** The 7621-line assembly took 35.9 seconds of clock time, 212 lines per second: 63.5 percent assembler execution, 16.5 percent system overhead, 20.0 percent disk wait. The authors decline to compare with other systems.
- **Usage.** 72 users, at most 14 simultaneous, 300 directories, 4400 files, 34000 blocks of 512 bytes. Per day: 1800 commands, 4.3 CPU hours, 70 connect hours, 30 different users and 75 logins. The C compiler took 15.7 percent of command CPU time and the editor was the most used command, at 15.3 percent of accesses.
- **Reliability.** Over one year on a very early 11/45: about one crash every other day (two thirds from hardware problems such as power dips), longest uninterrupted run about two weeks, total up time about 98 percent, and one file system lost (one disk out of five).
- **Design lessons.** The authors credit three influences: programming convenience through interactive use, severe size constraints, and the system maintaining itself. They name the Berkeley time-sharing system as the source of `fork` and Multics as the influence on the I/O calls and on the Shell.

## Critical Analysis

The paper is a design essay backed by one timing and one usage log, so most of its claims are argued rather than measured.

- **Evidence is thin.** The authors say they will not interpret the timing figures or compare them with other systems. Reliability is stated to be "much more subjective" and from recollection.
- **Simple choices with costs.** No locks, no links across file systems, and no charging for disk space were workable for a research group of 72 users on one machine. The paper does not claim they would hold up in a large or hostile environment.
- **Protection is minimal.** Permissions are read, write and execute for owner and others only, and the set-user-ID bit makes a privileged program safe only if it is carefully written, as the authors note.
- **Later literature (not part of this paper).** Ritchie's 1984 account, "The Evolution of the Unix Time-sharing System" (AT&T Bell Laboratories Technical Journal 63(8)), adds that pipes appeared in 1972, after the PDP-11 system was running, at M. D. McIlroy's urging, and that on the PDP-7 `fork` took 27 lines of assembly. He suggests the separate `fork` and `exec` exist mainly because fork was easy to implement, not through a deeper design principle. Baumann, Appavoo, Krieger and Roscoe, "A fork() in the road" (HotOS 2019), argue that `fork` was a clever hack for 1970s machines that has become a liability.

## Further Research

- How the file and process model scales: networking, many processors, locking and file system consistency after a crash.
- Replacing or extending `fork`, for example with spawn-style process creation or single-address-space designs such as [μFork](/papers/ufork-posix-fork-within-a-single-address-space-os).
- Moving file system code out of the kernel, as in [Oxbow](/papers/oxbow-coordinated-architecture-for-multi-component-file-systems) and [Trio](/papers/trio-high-performance-and-secure-userspace-nvm-file-systems).
- Stronger protection than owner, others and set-user-ID, and ways to make privileged programs safer.
- Reading the later history: Ritchie's 1984 paper for how the design emerged, and the Unix literature after 1974 for what changed.
