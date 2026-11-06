# AI Pipeline (design doc 3.4.5). Reads transcript.ready from RabbitMQ and answers soap.generated
# or soap.generation.failed. docker-compose.yml builds it from agent/ and passes the root .env.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY mediassist_agent mediassist_agent

RUN useradd --create-home agent
USER agent

CMD ["python", "-m", "mediassist_agent.run", "--rabbitmq"]
