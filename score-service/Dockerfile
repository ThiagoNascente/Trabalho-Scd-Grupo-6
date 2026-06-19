FROM python:3.12-slim

WORKDIR /app

# Instala dependências primeiro (cache de camada).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Servidor REST + thread do consumidor Kafka (ver app.py).
CMD ["python", "app.py"]
