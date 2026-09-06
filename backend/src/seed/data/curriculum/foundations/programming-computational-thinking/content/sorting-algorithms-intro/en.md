---
version: 1.0
updatedAt: 2026-09-06
---
## Objective

Sorting is one of the clearest places to see Big-O matter in practice: several intuitive sorting methods — bubble sort, selection sort, insertion sort — all do roughly `n²` comparisons in the worst case, while a divide-and-conquer approach like merge sort does roughly `n log n`. On a small list the difference is invisible; on a large one, it's the difference between a program that finishes instantly and one that doesn't finish at all within a reasonable time. This concept is a first pass — enough to compare the two families and see why the comparison matters, not an exhaustive tour of every sorting algorithm.

## Use Cases

- Choosing whether a simple sort is "good enough" for a small, fixed-size list versus a large or frequently-growing one.
- Recognizing the O(n²) pattern (nested loops, each over the same collection) when reading or writing a simple sort.
- Understanding merge sort as a first concrete example of divide-and-conquer, a strategy that reappears throughout algorithms.
- Building the intuition to reach for Python's built-in `sorted()` (which uses a highly-optimized O(n log n) algorithm) instead of hand-rolling a simple sort for real work.

## Deep Dive

### A quadratic sort: selection sort

```python
def selection_sort(items):
    items = items[:]                       # work on a clone, don't mutate the caller's list
    for i in range(len(items)):
        smallest = i
        for j in range(i + 1, len(items)):  # inner loop scans the unsorted remainder
            if items[j] < items[smallest]:
                smallest = j
        items[i], items[smallest] = items[smallest], items[i]
    return items

selection_sort([5, 2, 4, 1, 3])   # [1, 2, 3, 4, 5]
```

For each of the `n` positions, the inner loop scans the remaining unsorted portion looking for the smallest value — roughly `n` comparisons per outer iteration, across `n` outer iterations, giving the same O(n²) shape covered in big-o-and-asymptotic-complexity. Bubble sort and insertion sort differ in *how* they compare and move elements, but share this same quadratic worst case.

### A divide-and-conquer sort: merge sort

```python
def merge_sort(items):
    if len(items) <= 1:                 # base case — a list of 0 or 1 is already sorted
        return items
    mid = len(items) // 2
    left = merge_sort(items[:mid])       # recursively sort each half
    right = merge_sort(items[mid:])
    return merge(left, right)

def merge(left, right):
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            result.append(left[i]); i += 1
        else:
            result.append(right[j]); j += 1
    return result + left[i:] + right[j:]  # append whichever side has leftovers

merge_sort([5, 2, 4, 1, 3])   # [1, 2, 3, 4, 5]
```

Merge sort recursively splits the list in half (the "divide"), sorts each half on its own, and combines two already-sorted halves in a single linear pass (the "conquer"). Splitting in half repeatedly gives roughly `log n` levels of splitting, and each level does roughly `n` total work merging — giving O(n log n) overall, the same halving-the-problem idea bisection search relies on, applied to sorting instead of numeric search.

## Trade-offs

- **For a small list, the constant-factor overhead of merge sort's recursion and extra list creation can make it slower in practice than a simple O(n²) sort**, even though it's asymptotically better — Big-O describes growth, not the crossover point at which the better growth rate actually wins.
- **Selection, bubble, and insertion sort are simple to write and reason about, which is exactly why they're taught first — but that simplicity comes at the cost of O(n²) behavior that becomes unusable once the input is large.**
- **Merge sort as written above allocates a new list at every merge step, using O(n) extra memory** — a simple in-place O(n²) sort uses none; whether that memory cost is worth the better time complexity depends on how large the input actually is and how much memory is available.
- **In real code, none of this justifies hand-writing a sort at all** — Python's built-in `sorted()` and `.sort()` use Timsort, a highly-tuned O(n log n) algorithm that also takes advantage of already-sorted runs in the input; the algorithms here are for building intuition about complexity, not for replacing the standard library.

## Documentation Links

- [Python HOWTO — Sorting Techniques](https://docs.python.org/3/howto/sorting.html) — doc
- [MIT 6.100L — Materials by Lecture](https://ocw.mit.edu/courses/6-100l-introduction-to-cs-and-programming-using-python-fall-2022/pages/material-by-lecture/) — doc
