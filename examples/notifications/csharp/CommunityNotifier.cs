using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Threading;
using System.Threading.Tasks;

public sealed record Notification
{
    public required string Source { get; init; }
    public required string Severity { get; init; }
    public required string Title { get; init; }
    public required string Message { get; init; }
    public DateTimeOffset? Timestamp { get; init; }
    public Dictionary<string, object>? Context { get; init; }
}

public sealed record NotificationResult(string Id, string Status, string? OriginalId, string? OriginalStatus);
public sealed record NotificationFailure(string Code, string Error, int? RetryAfterSeconds);
public sealed class NotificationException(NotificationFailure failure) : Exception($"{failure.Code}: {failure.Error}")
{
    public string Code { get; } = failure.Code;
    public int? RetryAfterSeconds { get; } = failure.RetryAfterSeconds;
}

// Copy this file into a .NET 8+ app. Reuse one instance rather than creating one per message.
public sealed class CommunityNotifier : IDisposable
{
    private readonly HttpClient http;
    private readonly Uri endpoint;
    private readonly System.Text.Json.JsonSerializerOptions json = new(System.Text.Json.JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    public CommunityNotifier(string token, string endpoint = "http://127.0.0.1:3210/api/notifications")
    {
        this.endpoint = new Uri(endpoint);
        if (this.endpoint.Scheme != "http" || this.endpoint.Host != "127.0.0.1" ||
            this.endpoint.AbsolutePath != "/api/notifications" || this.endpoint.UserInfo != "" ||
            this.endpoint.Query != "" || this.endpoint.Fragment != "")
            throw new ArgumentException("Use http://127.0.0.1:<port>/api/notifications.");
        if (string.IsNullOrWhiteSpace(token)) throw new ArgumentException("Set the local notification credential.");
        http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
        {
            Timeout = TimeSpan.FromSeconds(120)
        };
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    public async Task<NotificationResult> SendAsync(Notification notification, CancellationToken cancellationToken = default)
    {
        using var response = await http.PostAsJsonAsync(endpoint, notification, json, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var failure = await response.Content.ReadFromJsonAsync<NotificationFailure>(json, cancellationToken)
                ?? new NotificationFailure("http_error", "Notification request failed.", null);
            throw new NotificationException(failure);
        }
        return await response.Content.ReadFromJsonAsync<NotificationResult>(json, cancellationToken)
            ?? throw new InvalidOperationException("Missing notification result.");
    }

    public void Dispose() => http.Dispose();
}
