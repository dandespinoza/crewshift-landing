/**
 * AdminApiClient - Fetch wrapper for the CrewShift Fastify API.
 *
 * The admin panel does NOT query the CrewShift database directly.
 * All data operations go through the Fastify API at /api/admin/* endpoints.
 */

export interface ApiError {
  status: number
  message: string
  details?: unknown
}

class AdminApiClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'
  }

  private buildUrl(path: string): string {
    const cleanBase = this.baseUrl.replace(/\/$/, '')
    const cleanPath = path.startsWith('/') ? path : `/${path}`
    return `${cleanBase}${cleanPath}`
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorBody = await response.text()
      let parsed: { message?: string; details?: unknown } | undefined
      try {
        parsed = JSON.parse(errorBody)
      } catch {
        // Response body is not JSON
      }

      const error: ApiError = {
        status: response.status,
        message: parsed?.message ?? `API request failed with status ${response.status}`,
        details: parsed?.details,
      }
      throw error
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T
    }

    return response.json() as Promise<T>
  }

  private buildHeaders(token: string): HeadersInit {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    }
  }

  async get<T>(path: string, token: string): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      method: 'GET',
      headers: this.buildHeaders(token),
      cache: 'no-store',
    })

    return this.handleResponse<T>(response)
  }

  async post<T>(path: string, body: unknown, token: string): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
    })

    return this.handleResponse<T>(response)
  }

  async patch<T>(path: string, body: unknown, token: string): Promise<T> {
    const response = await fetch(this.buildUrl(path), {
      method: 'PATCH',
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
    })

    return this.handleResponse<T>(response)
  }

  async delete(path: string, token: string): Promise<void> {
    const response = await fetch(this.buildUrl(path), {
      method: 'DELETE',
      headers: this.buildHeaders(token),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      let parsed: { message?: string; details?: unknown } | undefined
      try {
        parsed = JSON.parse(errorBody)
      } catch {
        // Response body is not JSON
      }

      const error: ApiError = {
        status: response.status,
        message: parsed?.message ?? `Delete request failed with status ${response.status}`,
        details: parsed?.details,
      }
      throw error
    }
  }
}

export const adminApi = new AdminApiClient()
