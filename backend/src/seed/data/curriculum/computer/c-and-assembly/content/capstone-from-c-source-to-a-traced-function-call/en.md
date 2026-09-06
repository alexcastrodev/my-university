---
version: 1.0
updatedAt: 2026-09-06
---
## Learning Objectives

- Name, in order, the four stages a real C toolchain uses to turn source code into an executable: preprocessing, compilation, assembly, and linking.
- Read gcc-generated x86-64 assembly for a small recursive function and map every instruction back to a specific concept covered earlier in this discipline.
- Trace, frame by frame, the exact sequence of stack states a recursive function's calls and returns produce, using the prologue/epilogue and calling-convention rules already covered.
- Explain, precisely and without hand-waving, what "the call stack" that `recursion` (`programming-computational-thinking`) asked the reader to trust actually consists of, physically.
- Identify which of this discipline's earlier concepts each stage of this trace depends on, demonstrating that the discipline's material composes into one coherent mechanism rather than a list of separate facts.

## Context & Motivation

`programming-computational-thinking/recursion` introduced recursive functions and asked the reader to trust, without yet being able to verify, that "the call stack remembers where to return to" for each nested call. Every concept in this discipline's second half — the process address space, the stack, x86-64 registers and instructions, the runtime stack's `call`/`ret` mechanism, stack frames, and the calling convention — has been building, piece by piece, toward being able to make that trust unnecessary: to show, concretely and completely, exactly what happens when a recursive C function executes, with nothing left implicit.

This capstone does exactly that, using the smallest complete example that still exercises every piece: a short recursive function, compiled with a real compiler to real x86-64 assembly, then traced call by call and return by return. Nothing here is a new concept — every single instruction in the traced assembly is an instance of something already covered earlier in this discipline, and pointing out exactly which concept each instruction belongs to is the entire point of doing this trace at all.

This concept also introduces, briefly, the one topic in CMU 15-213's real syllabus this discipline has deliberately treated as out of scope beyond a passing mention: **linking**. The full compilation pipeline (preprocess → compile → assemble → link) is named here specifically because it's the honest, complete answer to "how does C source become a running program" — but the deep mechanics of linking itself (symbol resolution, relocation records, static versus dynamic linking) are reserved for a more advanced systems discipline not yet reached in this curriculum, exactly as `digital-logic-computer-organization/assembly-to-machine-code-translation` already covered the analogous translation step for a small teaching ISA, without needing a full linker to do it.

## Core Theory

### The compilation pipeline: four stages, one at a time

```text
factorial.c  --[preprocess]-->  expanded source
             --[compile]------>  factorial.s   (x86-64 assembly, human-readable)
             --[assemble]----->  factorial.o    (machine code, object file)
             --[link]--------->  factorial      (executable, ready to run)
```

**Preprocessing** expands macros and `#include` directives into a single, fully-expanded source file — a purely textual transformation, with no knowledge of C's semantics yet. **Compilation** is where nearly everything this discipline has covered actually happens: the compiler translates C source into x86-64 assembly, applying every rule already established — variable placement (`the-process-address-space`), stack-frame layout (`stack-frames-prologue-and-epilogue`), the calling convention (`the-system-v-amd64-calling-convention`), and control-flow translation (`translating-control-flow-if-while-for`). **Assembly** takes that human-readable `.s` file and converts each mnemonic into its actual binary encoding — the exact "assembly-to-machine-code translation" concept `digital-logic-computer-organization` already covered structurally for a teaching ISA, now happening for real x86-64 instructions. **Linking**, the stage this discipline does not develop further, combines one or more object files (and any libraries a program depends on) into a single executable, resolving any reference from one file to a function or variable defined in another — a real, necessary step for any program built from more than one source file, but one whose internal mechanics (symbol tables, relocation) belong to a discipline this curriculum hasn't reached yet.

### The example: a small recursive function

```c
int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    return n * factorial(n - 1);
}
```

Compiled with `gcc -S -O0` (deliberately disabling optimizations, so the generated assembly follows the standard prologue/epilogue/calling-convention pattern exactly, rather than a heavily optimized, harder-to-read variant), the result looks like this, annotated against every earlier concept it uses:

```text
factorial:
    pushq %rbp                    ; prologue (stack-frames-prologue-and-epilogue)
    movq  %rsp, %rbp                ; prologue
    subq  $16, %rsp                  ; prologue: reserve space for n and a temporary
    movl  %edi, -4(%rbp)              ; store parameter n (arrived in %edi per
                                       ;   the-system-v-amd64-calling-convention)

    cmpl  $1, -4(%rbp)                ; condition codes (condition-codes-and-conditional-branches)
    jg    .L_recurse                  ; translating-control-flow-if-while-for: the "if" test

    movl  $1, %eax                     ; base case: return 1 (return value in %eax, per the ABI)
    jmp   .L_done

.L_recurse:
    movl  -4(%rbp), %eax                ; load n
    subl  $1, %eax                       ; compute n - 1  (arithmetic-and-logical-instructions)
    movl  %eax, %edi                      ; move n-1 into %edi: the ABI's first argument register
    call  factorial                        ; the-x86-64-runtime-stack-call-and-ret: recursive call
    imull -4(%rbp), %eax                   ; %eax (factorial(n-1)'s result) * n

.L_done:
    leave                                   ; epilogue (stack-frames-prologue-and-epilogue)
    ret                                     ; the-x86-64-runtime-stack-call-and-ret
```

Every single instruction here is traceable to a concept this discipline already covered — there is nothing new in this listing except the specific arrangement.

### Tracing the stack through `factorial(3)`

```mermaid
sequenceDiagram
    participant Main
    participant F3 as factorial(3)
    participant F2 as factorial(2)
    participant F1 as factorial(1)
    Main->>F3: call factorial (n=3 in %edi)
    F3->>F3: prologue; n=3 stored at -4(%rbp)
    F3->>F2: n<=1 false; call factorial (n=2 in %edi)
    F2->>F2: prologue; n=2 stored at -4(%rbp)
    F2->>F1: n<=1 false; call factorial (n=1 in %edi)
    F1->>F1: prologue; n=1 stored at -4(%rbp)
    F1->>F1: n<=1 true; %eax = 1
    F1->>F2: epilogue; ret (returns 1)
    F2->>F2: %eax = 1 * 2 = 2
    F2->>F3: epilogue; ret (returns 2)
    F3->>F3: %eax = 2 * 3 = 6
    F3->>Main: epilogue; ret (returns 6)
```

At the deepest point (inside `factorial(1)`), three complete stack frames exist simultaneously — `factorial(3)`'s, `factorial(2)`'s, and `factorial(1)`'s — each with its own copy of `n` at its own `-4(%rbp)`, exactly as `the-stack-and-automatic-storage` described conceptually and `stack-frames-prologue-and-epilogue` described structurally. As each call's base case is reached and it returns, its frame is torn down by its epilogue, and the multiplication (`imull -4(%rbp), %eax`) in the calling frame combines its own `n` with whatever the just-returned call left in `%eax` — the calling convention's designated return-value register.

## Worked Examples

### Example 1: what "the call stack remembers" actually means, made literal

`recursion` asked the reader to trust that a recursive call "remembers its place" and correctly resumes once a deeper call returns. The trace above shows exactly what that trust consists of: each call's own `n`, stored at its own frame's `-4(%rbp)`, survives the entire duration of every deeper call, specifically because `%rbp` is fixed per-frame (`stack-frames-prologue-and-epilogue`) and each frame's memory is untouched by anything a deeper call does to its own, separate frame. There is no "remembering" beyond ordinary memory persisting until it's explicitly reclaimed by an epilogue — the trust `recursion` asked for was always earned by this exact mechanism.

### Example 2: locating where the multiplication actually happens

```text
    call  factorial                ; recursive call: factorial(n-1)
    imull -4(%rbp), %eax           ; %eax (the JUST-RETURNED result) * n (still at -4(%rbp))
```

This is the single instruction where "n * factorial(n - 1)" actually happens, and it only works correctly because two facts, both already established separately in this discipline, hold simultaneously: the calling convention (`the-system-v-amd64-calling-convention`) guarantees `factorial(n-1)`'s result is in `%eax` the instant `call` returns, and the frame pointer (`stack-frames-prologue-and-epilogue`) guarantees `-4(%rbp)` still correctly names *this* frame's own `n`, completely unaffected by whatever the deeper, now-returned call did to its own, separate `-4(%rbp)`.

### Example 3: naming the pipeline stage each transformation belongs to

```text
factorial.c   → (compile) →   the assembly listing shown above
factorial.s   → (assemble) →  factorial.o (binary machine code, opcodes for
                                mov/cmp/jg/call/imul/leave/ret)
factorial.o   → (link) →      factorial (a runnable executable, e.g. combined
                                with a C library providing main's startup code)
```

Everything covered in this discipline's own worked examples has stopped at the "compile" stage — a human-readable assembly listing. The `assemble` stage (turning `movl`, `cmpl`, `jg`, and so on into their actual binary opcodes) is the real x86-64 instance of the same "assembly-to-machine-code translation" idea `digital-logic-computer-organization` already covered structurally, and the `link` stage — combining `factorial.o` with whatever else the final program needs, such as C's runtime startup code — is the one honestly out-of-scope piece of this pipeline, reserved for a discipline that hasn't been written yet.

## Common Misconceptions & Pitfalls

- **"Recursion works because the language has some special memory for recursive calls."** It works because of the exact same stack, prologue/epilogue, and calling-convention mechanism every ordinary (non-recursive) function call already uses — `factorial` calling itself is mechanically identical to any two different functions calling each other; nothing about recursion specifically requires new machinery.
- **"Once a deeper call returns, the calling frame has to somehow retrieve its own saved `n` from somewhere special."** It never needed retrieving — the calling frame's `n`, at its own fixed `-4(%rbp)` offset, was simply never touched by the deeper call's own, separate frame; "retrieving" it is just reading an address that was valid the entire time.
- **"Compiling with optimizations turned on would show a fundamentally different mechanism."** It would very likely produce different, often much shorter assembly (a compiler might keep `n` in a register instead of on the stack for a simple case like this, or even eliminate the recursive call in favor of an equivalent loop) — but every underlying rule this discipline covered (the calling convention, stack discipline when the stack IS used, condition codes) remains exactly the same; optimization changes what code is generated, not what conventions that code has to obey when it does use the stack or make a call.
- **"Linking is basically the same kind of step as assembling, just gluing files together."** It's a genuinely distinct problem — resolving every reference from one compiled file to a symbol (a function or variable) defined in another, and combining potentially many object files and libraries into one coherent address space — which is exactly why it's named here as a real, necessary stage but deliberately not developed further in this discipline.

## Summary

A real C toolchain turns source into a running program through four stages — preprocess, compile, assemble, and link — and the compile stage is where nearly every concept in this discipline's second half becomes visible at once: a small recursive function like `factorial`, compiled to x86-64 assembly, is a direct composition of the calling convention (arguments in `%edi`, results in `%eax`), condition codes and control-flow translation (the base-case `cmp`/`jg`), the runtime stack's `call`/`ret` mechanism, and the prologue/epilogue pattern that keeps every frame's own local variables — here, each recursive call's own copy of `n` — valid and undisturbed by any deeper call happening inside it. This is the complete, literal answer to the trust `programming-computational-thinking/recursion` asked the reader to place in "the call stack remembering where to return to": it remembers nothing beyond ordinary memory, in ordinary stack frames, governed by the exact rules this entire discipline has now made fully explicit.

## Documentation Links

- [Bryant & O'Hallaron — Computer Systems: A Programmer's Perspective (CS:APP)](https://csapp.cs.cmu.edu/) — textbook whose full treatment of compiling, assembling, and linking C programs this capstone's pipeline overview follows.
- [CMU 15-213 — Introduction to Computer Systems](https://www.cs.cmu.edu/~213/) — course whose real lecture sequence (machine programming, then linking, as a later, separate topic) confirms linking's place as a distinct stage this discipline deliberately does not develop further.
