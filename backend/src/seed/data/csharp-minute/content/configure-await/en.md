---
version: 1.0
updatedAt: 2026-10-02
---
## Question

# What does `ConfigureAwait(false)` actually do?

## Short Answer

It tells `await` **not to come back to the original context** to run the rest of the method. The continuation runs wherever the awaited task completed, usually on a thread pool thread. It has nothing to do with "configuring" the task itself.

## What It Is

When you `await` a task that isn't finished yet, the compiler captures the current `SynchronizationContext` (or the current `TaskScheduler`) and, when the task completes, posts the rest of your method back to it.

In a UI app (WPF, WinForms, MAUI), that context is the UI thread. That's exactly what you want in event handlers: after `await`, you can touch controls again. In library code, though, hopping back to the UI thread is pure overhead, and it can be worse than that.

## The Classic Deadlock

1. A UI event handler calls `GetDataAsync().Result`, blocking the UI thread.
2. Inside `GetDataAsync`, an `await` captured the UI context.
3. When the I/O finishes, the continuation needs the UI thread to resume.
4. The UI thread is blocked waiting for that same continuation. Nobody moves.

If the library had used `ConfigureAwait(false)`, the continuation would run on the thread pool, the task would complete, and `.Result` would return. (The real fix is not to block on async code, but libraries can't control their callers.)

## Practical Example

```csharp
// Library code: does not care which thread resumes it
public async Task<string> ReadConfigAsync(string path)
{
    string text = await File.ReadAllTextAsync(path).ConfigureAwait(false);
    return text.Trim();
}

// UI code: must resume on the UI thread to update the label
private async void OnLoadClicked(object sender, EventArgs e)
{
    string config = await _service.ReadConfigAsync("app.json");
    _statusLabel.Text = config;
}

// .NET 8+: more control with ConfigureAwaitOptions
await task.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
```

## Solution and Conclusion

Rule of thumb: in **general-purpose library code**, use `ConfigureAwait(false)` on every `await`. In **application code** (UI handlers, controllers), just `await` normally. ASP.NET Core has no `SynchronizationContext`, so there it makes no behavioral difference, but your library may still be called from a UI app one day.

## References

- [ConfigureAwait FAQ: .NET Blog](https://devblogs.microsoft.com/dotnet/configureawait-faq/) (doc)
- [Task.ConfigureAwait: .NET API](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.configureawait) (doc)
