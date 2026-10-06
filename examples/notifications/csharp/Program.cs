var token = Environment.GetEnvironmentVariable("COMMUNITY_NOTIFICATION_TOKEN")
    ?? throw new InvalidOperationException("Set COMMUNITY_NOTIFICATION_TOKEN in this caller's environment.");
using var notifier = new CommunityNotifier(token,
    Environment.GetEnvironmentVariable("COMMUNITY_NOTIFICATION_URL") ?? "http://127.0.0.1:3210/api/notifications");
var result = await notifier.SendAsync(new Notification
{
    Source = "Build Agent",
    Severity = "Attention",
    Title = "Needs attention",
    Message = "Could not verify the expected UI state."
});
Console.WriteLine($"{result.Status}: {result.Id}");
