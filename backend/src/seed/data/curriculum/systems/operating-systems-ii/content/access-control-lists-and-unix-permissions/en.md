---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Define an access control list (ACL) as an object-centered answer to "who may do what to this object," expressed as a list attached to the object itself.
- Explain Unix's read/write/execute permission bits as a deliberately simplified, three-bucket ACL, and precisely what each bit means for a file versus a directory.
- Describe the "check on every access, not just once" enforcement model an ACL relies on, and connect it to the kernel-boundary validation already covered earlier in this discipline.
- Distinguish authorization enforcement (this concept's subject) from the authentication and authorization theory already covered in `security-cryptography`, framing this concept as the concrete OS mechanism that theory relies on.

## Context & Motivation

This discipline's virtualization cluster showed how the kernel can give a process a restricted *view* of the machine. This final cluster turns to a related but distinct question: given a process that can see a particular file, device, or other kernel-managed object, what actually decides whether it is *allowed* to read, write, or otherwise act on that object — and how is that decision actually enforced, mechanically, by the kernel, every single time the process attempts an access?

`security-cryptography` already developed authentication (proving who you are) and authorization (deciding what you may do) as general security concepts, and distinguished them carefully from each other. This concept picks up specifically where that theory leaves off: the access control list is the concrete data structure real operating systems attach to objects to encode an authorization policy, and Unix's permission bits are the specific, deliberately minimal instance of this idea that appears on every Unix-like file, directory, and device this discipline's earlier file-system concept already introduced.

## Core Theory

### The access control list: a policy attached to the object, not the subject

An access control list is, conceptually, exactly what its name suggests: a list, attached to a particular object, naming which subjects (users, or more generally, security principals) may perform which operations on that object. This is an *object-centered* way of expressing an authorization policy — to answer "can Alice read this file," the kernel consults the file's own ACL and checks whether Alice (or a group Alice belongs to) appears in it with read permission — as opposed to a *subject-centered* approach (asking "what can Alice do," consulting a list attached to Alice rather than to the object), which the next concept, capability-based security, develops as a genuinely different model.

### Unix permission bits: a real, deliberately minimal ACL

Unix and Unix-like systems (Linux, macOS, BSD) implement authorization with a specific, extremely widely deployed simplification of the general ACL idea: each file or directory carries exactly three permission triples — one for its owning user, one for its owning group, and one for everyone else — each triple made of exactly three bits: read, write, and execute. This is a real ACL, just with a fixed, deliberately small set of possible "entries" (owner, group, other) rather than an arbitrarily long list naming individual users — a design choice trading expressiveness (a full ACL can name arbitrarily many individual subjects) for simplicity and compactness (nine bits, stored directly alongside the file's other metadata, answer the vast majority of real authorization questions a Unix system needs to answer).

The meaning of each bit differs in a genuinely important way between a regular file and a directory — a distinction that trips up many learners precisely because the bit names (read, write, execute) sound like they should mean the same thing in both cases, but do not:

```text
Permission bit    On a regular file                On a directory
----------------  --------------------------------  --------------------------------------
read (r)          May read the file's contents       May LIST the directory's entries
write (w)         May modify the file's contents     May CREATE/DELETE entries within it
execute (x)       May execute the file as a program  May ENTER the directory (cd into it,
                                                       or access files within by name)
```

A directory with read but not execute permission, for instance, allows listing filenames within it but not actually accessing any file by that name — a real, sometimes-surprising consequence of what "execute" concretely means for a directory rather than an ordinary file.

### Enforcement: checked on every access, at the kernel boundary

An ACL (or Unix's permission bits) is only meaningful if it is actually checked, reliably, every single time a process attempts an access — and this check happens at exactly the same kernel boundary this discipline's earlier concepts already established as the sole gateway between user-mode code and any kernel-mediated resource. When a process calls `open()` on a file, the kernel's file-system code (already covered in `operating-systems-i`) compares the calling process's user and group identity against the file's owner, group, and permission bits, before returning a valid file descriptor at all — precisely the same "never trust, always validate at the boundary" discipline this discipline's earlier kernel-boundary-validation concept already established, now applied to an authorization decision rather than a raw pointer's validity.

```mermaid
flowchart TB
    A["Process calls open(\"secret.txt\", O_RDWR)"] --> B{"Kernel checks:\ndoes calling process's\nuid/gid match file's\nowner/group permission bits?"}
    B -->|Permission denied| C["open() fails,\nreturns -EACCES"]
    B -->|Permitted| D["open() succeeds,\nreturns a valid file descriptor"]
```

### Where authorization theory ends and this concept's mechanism begins

`security-cryptography` established authorization as a general concept: deciding what an already-authenticated subject may do. This concept is the concrete machinery a real operating system uses to make that decision for the specific, extremely common case of "may this process access this file, directory, or device": the ACL as a data structure, Unix permission bits as its widely deployed simplified instance, and the kernel's own file-system code as the enforcement point that consults it on every single access attempt, never merely once at login time.

## Worked Examples

### Example 1: Reading Unix permission bits, concretely

```text
File listing: -rw-r--r-- 1 alice staff  1024 report.txt

Decoded:
  -            regular file (not a directory)
  rw-          owner (alice): read + write, not execute
  r--          group (staff): read only
  r--          other (everyone else): read only

Concretely: alice can read and modify report.txt; anyone in the
staff group can read it but not modify it; everyone else can also
read it but not modify it; nobody but alice can execute it as a
program (which is appropriate here, since it's a text report, not
an executable).
```

### Example 2: The directory permission-bit distinction, made concrete

```text
Directory: drwxr-x---  alice  staff  reports/

Decoded: owner (alice) has rwx; group (staff) has r-x; other has ---.

A member of "staff" who is NOT alice:
  Can LIST the contents of reports/ (has read on the directory)
  Can ENTER reports/ and access files within it BY NAME
    (has execute on the directory)
  CANNOT create or delete files within reports/
    (lacks write on the directory)

A user in neither alice nor staff:
  Cannot list, enter, or access anything within reports/ at all
    (no permission bits set for "other")
```

### Example 3: The exact kernel check, traced through a real `open()` call

```text
Process (uid=1002, gid=20) calls: open("secret.txt", O_WRONLY)

File's metadata: owner uid=1001, owner gid=20,
                  permission bits rw-r-----

Kernel's check:
  Is calling uid (1002) == owner uid (1001)?  No.
  Is calling gid (20) == owner gid (20)?      Yes -> use GROUP bits.
  Group bits: r-- (read only, no write)
  Requested access: O_WRONLY (write)

Result: PERMISSION DENIED (-EACCES) -- the calling process is in
the right group, but that group only has read permission, not write,
so the write-mode open() fails even though the file IS readable to
this same process.
```

## Common Misconceptions & Pitfalls

- **"Unix permission bits and access control lists are two unrelated authorization mechanisms."** Unix permission bits ARE an access control list — a real, deliberately minimal one, with exactly three fixed entries (owner, group, other) rather than an arbitrary list of individually named subjects, but structurally the same object-centered "who may do what to this object" idea.
- **"Read and execute permission mean the same thing for a directory as they do for a regular file."** For a directory, read permission means listing its entries, and execute permission means being able to enter it or access files within it by name — genuinely different meanings than "read the file's bytes" and "run the file as a program," a distinction that causes real, common confusion.
- **"Once a process successfully opens a file, permission is no longer relevant for that file descriptor."** The relevant permission check happens at `open()` time for that particular access mode; a process holding an open file descriptor does not need to be re-checked for every subsequent read/write on that same descriptor, but a NEW access attempt (a fresh `open()` call) is checked again, independently, against the file's current permission bits.
- **"Access control lists are only a Unix-specific idea, with no broader theoretical basis."** The object-centered "who may do what" ACL model is a general concept appearing across many real systems (Windows ACLs are considerably richer than Unix's three-bucket simplification, for instance) — Unix's specific nine-bit implementation is one deliberately minimal, extremely widely deployed instance of a broader idea.

## Summary

An access control list attaches, to each object, a policy naming which subjects may perform which operations on it — an object-centered answer to the authorization question `security-cryptography` already introduced in the abstract. Unix's read/write/execute permission bits are a real, deliberately minimal ACL, with exactly three fixed entries (owner, group, other) rather than an arbitrary per-subject list, and a meaning for each bit that differs in a genuinely important way between regular files (read the contents, modify the contents, execute as a program) and directories (list entries, create/delete entries, enter the directory or access files by name). This policy is enforced at exactly the kernel boundary this discipline's earlier concepts already established as the sole gateway to kernel-mediated resources, checked freshly on every new access attempt rather than merely once — the concrete, mechanical answer to a question `security-cryptography`'s authorization theory left open: how, precisely, does an operating system decide and enforce who may do what to a given file. The next concept develops a genuinely different model for the same underlying question.

## Documentation Links

- [OSTEP — Access Control](https://pages.cs.wisc.edu/~remzi/OSTEP/security-access.pdf) — the ACL model and Unix permission-bit mechanics this concept develops in detail.
- [ACM/IEEE CS2013 — Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/) — situates access control as a core Operating Systems topic within the broader curriculum.
