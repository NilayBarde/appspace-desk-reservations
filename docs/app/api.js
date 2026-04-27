export function createApi(fetchFn, token) {
  async function request(method, path, body) {
    const options = {
      method,
      headers: {
        accept: "application/json",
        token,
        "content-type": "application/json;charset=UTF-8",
        "x-appspace-request-timezone": "America/New_York",
      },
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetchFn(path, options);
    const data = await res.json();
    return { status: res.status, body: data };
  }

  return {
    async verifyToken() {
      const today = new Date().toISOString().slice(0, 10);
      const { status } = await request(
        "GET",
        `/api/v3/reservation/users/me/events?startAt=${today}T00:00:00.000Z&endAt=${today}T00:00:01.000Z&limit=1`
      );
      return status !== 401 && status !== 403;
    },

    async getResourceEvents(resourceId, startDate, endDate) {
      const { body } = await request(
        "GET",
        `/api/v3/reservation/resources/${resourceId}/events?sort=startAt&startAt=${startDate}T00:00:00.000Z&endAt=${endDate}T23:59:59.000Z&page=1&start=0&limit=500`
      );
      return body.items || [];
    },

    async createReservation(resourceId, dateStr, startTime, endTime, user) {
      return request("POST", "/api/v3/reservation/reservations", {
        resourceIds: [resourceId],
        effectiveStartAt: `${dateStr}T${startTime}`,
        effectiveEndAt: `${dateStr}T${endTime}`,
        organizer: { id: user.id, name: user.name },
        sensitivity: "Public",
        organizerAvailabilityType: "Busy",
        attendees: [{
          displayName: user.name,
          email: user.email,
          resourceIds: [resourceId],
          attendanceType: "InPerson",
          userId: user.id,
          id: user.id,
        }],
        visitors: [],
        isAllDay: false,
        startTimeZone: "America/New_York",
        endTimeZone: "America/New_York",
      });
    },

    async patchEventDate(eventId, dateStr, startTime, endTime) {
      return request("PATCH", `/api/v3/reservation/events/${eventId}`, {
        startAt: `${dateStr}T${startTime}`,
        endAt: `${dateStr}T${endTime}`,
        reservationStartAt: `${dateStr}T${startTime}`,
        reservationEndAt: `${dateStr}T${endTime}`,
      });
    },

    async deleteReservation(reservationId) {
      return request("DELETE", `/api/v3/reservation/reservations/${reservationId}`);
    },
  };
}
