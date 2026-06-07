"""Cálculo do delta de antecipação vs TLE público e banco de dados histórico.

Este script cria um banco SQLite local para armazenar séries históricas de TLEs,
associar satélites a operadores, importar CSVs e gerar relatórios por satélite
ou operador.

Variáveis principais:
- T_manobra: momento real da manobra do satélite não cooperativo.
- T_Mitchell: momento em que o Mitchell detectou a anomalia.
- T_TLE_publico: timestamp do primeiro TLE público que refletiu a nova órbita.

Fórmulas:
- Delta de antecipação: T_TLE_publico - T_Mitchell
- Latência pública: T_TLE_publico - T_manobra
"""

from __future__ import annotations

import argparse
import csv
import datetime
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


DEFAULT_DB_PATH = Path(__file__).with_suffix(".db")


@dataclass
class TLESample:
    epoch: datetime.datetime
    mean_motion: float
    eccentricity: float
    inclination: float
    raan: float
    arg_perigee: float
    mean_anomaly: float
    sat_id: str = ""
    operator_name: Optional[str] = None


def parse_datetime(value: str) -> datetime.datetime:
    value = value.strip()
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    dt = datetime.datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc)


def format_timedelta(delta: datetime.timedelta) -> str:
    total_minutes = int(delta.total_seconds() / 60)
    hours, minutes = divmod(abs(total_minutes), 60)
    sign = "-" if total_minutes < 0 else ""
    return f"{sign}{hours}h{minutes:02d}m"


def compute_antecipation(
    t_mitchell: datetime.datetime,
    t_tle_publico: datetime.datetime,
) -> Tuple[float, datetime.timedelta]:
    delta = t_tle_publico - t_mitchell
    return delta.total_seconds() / 60.0, delta


def compute_public_latency(
    t_manobra: datetime.datetime,
    t_tle_publico: datetime.datetime,
) -> Tuple[float, datetime.timedelta]:
    latency = t_tle_publico - t_manobra
    return latency.total_seconds() / 60.0, latency


def init_database(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS operators (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS satellites (
            sat_id TEXT PRIMARY KEY,
            operator_id INTEGER,
            FOREIGN KEY(operator_id) REFERENCES operators(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tle_records (
            id INTEGER PRIMARY KEY,
            sat_id TEXT NOT NULL,
            epoch TEXT NOT NULL,
            mean_motion REAL NOT NULL,
            eccentricity REAL NOT NULL,
            inclination REAL NOT NULL,
            raan REAL NOT NULL,
            arg_perigee REAL NOT NULL,
            mean_anomaly REAL NOT NULL,
            source TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(sat_id) REFERENCES satellites(sat_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_tle_sat_epoch ON tle_records (sat_id, epoch)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sat_operator ON satellites (operator_id)")
    conn.commit()
    return conn


def get_or_create_operator(conn: sqlite3.Connection, operator_name: str) -> int:
    cursor = conn.execute("SELECT id FROM operators WHERE name = ?", (operator_name,))
    row = cursor.fetchone()
    if row:
        return row[0]
    cursor = conn.execute("INSERT INTO operators (name) VALUES (?)", (operator_name,))
    conn.commit()
    return cursor.lastrowid


def get_or_create_satellite(conn: sqlite3.Connection, sat_id: str, operator_name: Optional[str]) -> None:
    cursor = conn.execute("SELECT sat_id FROM satellites WHERE sat_id = ?", (sat_id,))
    if cursor.fetchone():
        return
    operator_id = None
    if operator_name:
        operator_id = get_or_create_operator(conn, operator_name)
    conn.execute(
        "INSERT INTO satellites (sat_id, operator_id) VALUES (?, ?)"
        , (sat_id, operator_id)
    )
    conn.commit()


def insert_tle_record(conn: sqlite3.Connection, sample: TLESample, source: str = "space-track") -> None:
    get_or_create_satellite(conn, sample.sat_id, sample.operator_name)
    conn.execute(
        "INSERT INTO tle_records (sat_id, epoch, mean_motion, eccentricity, inclination, raan, arg_perigee, mean_anomaly, source, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        , (
            sample.sat_id,
            sample.epoch.isoformat(),
            sample.mean_motion,
            sample.eccentricity,
            sample.inclination,
            sample.raan,
            sample.arg_perigee,
            sample.mean_anomaly,
            source,
            datetime.datetime.now(datetime.timezone.utc).isoformat(),
        )
    )


def insert_tle_records(conn: sqlite3.Connection, samples: Iterable[TLESample], source: str = "space-track") -> int:
    count = 0
    for sample in samples:
        insert_tle_record(conn, sample, source=source)
        count += 1
    conn.commit()
    return count


def get_tle_history(
    conn: sqlite3.Connection,
    sat_id: str,
    last_days: Optional[int] = 30,
) -> List[TLESample]:
    if last_days is None:
        rows = conn.execute(
            "SELECT epoch, mean_motion, eccentricity, inclination, raan, arg_perigee, mean_anomaly, sat_id"
            " FROM tle_records"
            " WHERE sat_id = ?"
            " ORDER BY epoch ASC",
            (sat_id,),
        ).fetchall()
    else:
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=last_days)
        rows = conn.execute(
            "SELECT epoch, mean_motion, eccentricity, inclination, raan, arg_perigee, mean_anomaly, sat_id"
            " FROM tle_records"
            " WHERE sat_id = ? AND epoch >= ?"
            " ORDER BY epoch ASC",
            (sat_id, cutoff.isoformat()),
        ).fetchall()

    return [
        TLESample(
            epoch=parse_datetime(row[0]),
            mean_motion=row[1],
            eccentricity=row[2],
            inclination=row[3],
            raan=row[4],
            arg_perigee=row[5],
            mean_anomaly=row[6],
            sat_id=row[7],
        )
        for row in rows
    ]


def get_sat_ids_by_operator(conn: sqlite3.Connection, operator_name: str) -> List[str]:
    rows = conn.execute(
        "SELECT s.sat_id"
        " FROM satellites s"
        " JOIN operators o ON s.operator_id = o.id"
        " WHERE o.name = ?",
        (operator_name,),
    ).fetchall()
    return [row[0] for row in rows]


def list_operators(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute("SELECT name FROM operators ORDER BY name ASC").fetchall()
    return [row[0] for row in rows]


def angle_diff_degrees(a: float, b: float) -> float:
    diff = abs(a - b) % 360.0
    return min(diff, 360.0 - diff)


def compute_historical_average_deltas(samples: List[TLESample]) -> Optional[Dict[str, float]]:
    if len(samples) < 2:
        return None

    count = 0
    total_mean_motion_ppm = 0.0
    total_ecc = 0.0
    total_inc_arcsec = 0.0
    total_raan_arcsec = 0.0
    total_argp_arcsec = 0.0
    total_ma_arcsec = 0.0
    total_interval_minutes = 0.0

    previous = samples[0]
    for current in samples[1:]:
        count += 1
        total_mean_motion_ppm += 1e6 * abs(current.mean_motion - previous.mean_motion) / previous.mean_motion
        total_ecc += abs(current.eccentricity - previous.eccentricity)
        total_inc_arcsec += angle_diff_degrees(previous.inclination, current.inclination) * 3600.0
        total_raan_arcsec += angle_diff_degrees(previous.raan, current.raan) * 3600.0
        total_argp_arcsec += angle_diff_degrees(previous.arg_perigee, current.arg_perigee) * 3600.0
        total_ma_arcsec += angle_diff_degrees(previous.mean_anomaly, current.mean_anomaly) * 3600.0
        total_interval_minutes += (current.epoch - previous.epoch).total_seconds() / 60.0
        previous = current

    return {
        "count": count,
        "avg_mean_motion_ppm": total_mean_motion_ppm / count,
        "avg_delta_eccentricity": total_ecc / count,
        "avg_delta_inclination_arcsec": total_inc_arcsec / count,
        "avg_delta_raan_arcsec": total_raan_arcsec / count,
        "avg_delta_arg_perigee_arcsec": total_argp_arcsec / count,
        "avg_delta_mean_anomaly_arcsec": total_ma_arcsec / count,
        "avg_interval_minutes": total_interval_minutes / count,
    }


def query_historical_averages(
    conn: sqlite3.Connection,
    sat_id: str,
    last_days: Optional[int] = 30,
) -> Optional[Dict[str, float]]:
    samples = get_tle_history(conn, sat_id, last_days=last_days)
    return compute_historical_average_deltas(samples)


def detect_maneuver_time(
    samples: List[TLESample],
    threshold_mean_motion_ppm: float = 50.0,
    min_consecutive: int = 2,
) -> Optional[datetime.datetime]:
    if len(samples) < 2:
        return None

    sorted_samples = sorted(samples, key=lambda s: s.epoch)
    previous = sorted_samples[0]
    consecutive = 0
    for current in sorted_samples[1:]:
        delta = abs(current.mean_motion - previous.mean_motion)
        relative_ppm = 1e6 * delta / previous.mean_motion
        if relative_ppm >= threshold_mean_motion_ppm:
            consecutive += 1
            if consecutive >= min_consecutive:
                return current.epoch
        else:
            consecutive = 0
        previous = current
    return None


def estimate_public_tle_maneuver_time(
    tle_updates: List[TLESample],
    maneuver_time: datetime.datetime,
) -> Optional[datetime.datetime]:
    for sample in sorted(tle_updates, key=lambda s: s.epoch):
        if sample.epoch >= maneuver_time:
            return sample.epoch
    return None


def parse_csv_tle(path: Path) -> List[TLESample]:
    samples: List[TLESample] = []
    with path.open("r", newline="", encoding="utf-8") as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            if not row.get("sat_id") or not row.get("epoch"):
                continue
            samples.append(
                TLESample(
                    sat_id=row["sat_id"].strip(),
                    operator_name=row.get("operator_name", "").strip() or None,
                    epoch=parse_datetime(row["epoch"].strip()),
                    mean_motion=float(row["mean_motion"]),
                    eccentricity=float(row["eccentricity"]),
                    inclination=float(row["inclination"]),
                    raan=float(row["raan"]),
                    arg_perigee=float(row["arg_perigee"]),
                    mean_anomaly=float(row["mean_anomaly"]),
                )
            )
    return samples


def summarize_satellite_report(
    conn: sqlite3.Connection,
    sat_id: str,
    last_days: Optional[int] = 30,
) -> None:
    samples = get_tle_history(conn, sat_id, last_days=last_days)
    averages = compute_historical_average_deltas(samples)
    if not averages:
        print(f"Satélite {sat_id}: não há histórico suficiente para calcular médias.")
        return

    print(f"--- Relatório do satélite {sat_id} ---")
    print(f"Registros usados: {averages['count']}")
    print(f"Δ mean motion médio: {averages['avg_mean_motion_ppm']:.4f} ppm")
    print(f"Δ eccentricidade médio: {averages['avg_delta_eccentricity']:.8f}")
    print(f"Δ inclinação médio: {averages['avg_delta_inclination_arcsec']:.1f} arcsec")
    print(f"Δ RAAN médio: {averages['avg_delta_raan_arcsec']:.1f} arcsec")
    print(f"Δ argumento do perigeu médio: {averages['avg_delta_arg_perigee_arcsec']:.1f} arcsec")
    print(f"Δ anomalia média: {averages['avg_delta_mean_anomaly_arcsec']:.1f} arcsec")
    print(f"Intervalo médio entre registros: {averages['avg_interval_minutes']:.1f} minutos")


def summarize_operator_report(
    conn: sqlite3.Connection,
    operator_name: str,
    last_days: Optional[int] = 30,
) -> None:
    sat_ids = get_sat_ids_by_operator(conn, operator_name)
    if not sat_ids:
        print(f"Operador '{operator_name}' não encontrado ou sem satélites registrados.")
        return

    print(f"--- Relatório do operador {operator_name} ---")
    for sat_id in sat_ids:
        summarize_satellite_report(conn, sat_id, last_days=last_days)


def run_example(conn: sqlite3.Connection) -> None:
    t_manobra = parse_datetime("2025-12-10T10:00:00+00:00")
    t_mitchell = parse_datetime("2025-12-10T11:15:00+00:00")
    t_tle_publico = parse_datetime("2025-12-10T16:30:00+00:00")

    delta_minutes, delta_td = compute_antecipation(t_mitchell, t_tle_publico)
    latency_minutes, latency_td = compute_public_latency(t_manobra, t_tle_publico)

    print("--- Exemplo prático simulado ---")
    print("T_manobra:", t_manobra.isoformat())
    print("T_Mitchell:", t_mitchell.isoformat())
    print("T_TLE_publico:", t_tle_publico.isoformat())
    print()
    print("Delta de antecipação (Mitchell vs TLE público):")
    print(f"  {delta_minutes:.1f} minutos ({format_timedelta(delta_td)})")
    print("  Sucesso" if delta_minutes > 0 else "  Não houve antecipação")
    print()
    print("Latência do dado público em relação à manobra:")
    print(f"  {latency_minutes:.1f} minutos ({format_timedelta(latency_td)})")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Banco de dados TLE e cálculo de antecipação Mitchell vs TLE público")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Caminho do arquivo SQLite")
    parser.add_argument("--import-csv", type=Path, help="Importa um CSV de TLEs para o banco")
    parser.add_argument("--csv-source", default="historical-csv", help="Fonte associada aos registros importados")
    parser.add_argument("--report-sat", help="Gera relatório histórico para um satélite específico")
    parser.add_argument("--report-operator", help="Gera relatório histórico para um operador")
    parser.add_argument("--last-days", type=int, default=30, help="Janela de dias para relatórios (use 0 para todo o histórico)")
    parser.add_argument("--list-operators", action="store_true", help="Lista operadores cadastrados")
    parser.add_argument("--example", action="store_true", help="Executa o exemplo simulado de cálculo")
    args = parser.parse_args()

    conn = init_database(args.db)
    if args.import_csv:
        samples = parse_csv_tle(args.import_csv)
        inserted = insert_tle_records(conn, samples, source=args.csv_source)
        print(f"Importados {inserted} registros de {args.import_csv}")

    if args.list_operators:
        operators = list_operators(conn)
        print("--- Operadores cadastrados ---")
        print("\n".join(operators) if operators else "Nenhum operador cadastrado.")

    last_days = None if args.last_days == 0 else args.last_days
    if args.report_sat:
        summarize_satellite_report(conn, args.report_sat, last_days=last_days)

    if args.report_operator:
        summarize_operator_report(conn, args.report_operator, last_days=last_days)

    if args.example:
        run_example(conn)

    if not any([args.import_csv, args.report_sat, args.report_operator, args.list_operators, args.example]):
        parser.print_help()


if __name__ == "__main__":
    main()
