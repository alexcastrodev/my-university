---
version: 1.0
updatedAt: 2026-07-31
title: Configuração de Job no Spring Batch: Restart, Incrementer e Validator
---
## Objective

Conhecer o modelo Job/Step (coberto em `spring-batch-job-model`) é só metade
da história — um job também precisa dizer se pode ser reiniciado, como novos
parâmetros de execução são gerados para runs repetidas, e se uma execução deve
ser rejeitada de cara por parâmetros ausentes. O livro expressa essas três
coisas como atributos e elementos filhos do vocabulário XML `<job>`/`<step>`;
hoje as mesmas três preocupações são expressas como chamadas de método no
`JobBuilder`.

## Use Cases

- Marcar um job de execução única (ex.: um job destrutivo de migração de
  dados) como não reiniciável, para que uma segunda tentativa de execução
  falhe ruidosamente em vez de rodar de novo, em silêncio, um trabalho
  destrutivo.
- Gerar automaticamente um parâmetro novo e sempre único (como uma data de
  execução) a cada nova execução de um job recorrente, sem que quem chama
  precise calculá-lo por conta própria.
- Rejeitar a execução de um job imediatamente — antes de qualquer step rodar
  — quando um parâmetro obrigatório (como `date`) está ausente, em vez de
  falhar lá no fundo da lógica de um step.

## Deep Dive

### Comportamento de restart: atributo `restartable` → `preventRestart()`

O XML do livro faz todo job ser reiniciável por padrão e desativa isso por
job:

```xml
<batch:job id="importProductsJob" restartable="false">
  ...
</batch:job>
```

O equivalente em Java mantém o mesmo padrão (reiniciável) e desativa com uma
única chamada de builder — sem flag booleana para inverter por engano:

```java
@Bean
public Job importProductsJob(JobRepository jobRepository, Step readWrite) {
    return new JobBuilder("importProductsJob", jobRepository)
        .preventRestart()
        .start(readWrite)
        .build();
}
```

Um job construído com `.preventRestart()` lança `JobRestartException` em
qualquer tentativa de executá-lo de novo, exatamente como na versão XML — a
garantia é idêntica, só a grafia mudou.

### Gerando parâmetros novos: atributo `incrementer` → `.incrementer(...)`

`JobLauncher.run(...)` (ou o atual `JobOperator.start(...)`) nunca inventa
parâmetros sozinho — algo precisa fornecê-los. Para jobs executados
repetidamente com parâmetros que precisam ser diferentes a cada vez, um
`JobParametersIncrementer` calcula o próximo valor a partir do último:

```java
public interface JobParametersIncrementer {
    JobParameters getNext(JobParameters parameters);
}
```

```java
@Bean
public Job importProductsJob(JobRepository jobRepository, Step readWrite) {
    return new JobBuilder("importProductsJob", jobRepository)
        .incrementer(new CustomIncrementer())
        .start(readWrite)
        .build();
}
```

Isso só importa quando o mecanismo de execução pede explicitamente "a próxima
instância" (historicamente via `JobOperator.startNextInstance`); quem sempre
fornece seus próprios parâmetros explícitos (ex.: uma `date` calculada
externamente) não precisa de incrementer nenhum.

### Rejeitando execuções ruins de cara: `<validator>` → `.validator(...)`

```java
public interface JobParametersValidator {
    void validate(JobParameters parameters) throws JobParametersInvalidException;
}
```

```java
@Bean
public Job importProductsJob(JobRepository jobRepository, Step readWrite) {
    return new JobBuilder("importProductsJob", jobRepository)
        .validator(parametersValidator())
        .start(readWrite)
        .build();
}

@Bean
public JobParametersValidator parametersValidator() {
    var validator = new DefaultJobParametersValidator();
    validator.setRequiredKeys(new String[]{"date"});
    validator.setOptionalKeys(new String[]{"productId"});
    return validator;
}
```

`DefaultJobParametersValidator` (inalterado em relação à versão do livro)
cobre o caso comum — chaves obrigatórias vs. opcionais — sem precisar
escrever uma classe validadora customizada; o job falha com
`JobParametersInvalidException` antes de qualquer step rodar, caso uma chave
obrigatória esteja ausente.

### Sequenciamento de steps e reuso de configuração via "parent"/"abstract"

O atributo `next` do livro em `<step>` encadeia steps declarativamente; a
forma em Java é a mesma cadeia `.next(...)` já usada para construir fluxos
lineares ou ramificados (veja `spring-batch-job-instance-execution-flow`).
Onde os atributos XML `parent`/`abstract` do livro deixam uma configuração de
step ou job estender outra para evitar repetição, a configuração em Java não
tem um mecanismo dedicado de "job abstrato" — o mesmo reuso é alcançado com
reuso de código comum (um método de builder compartilhado, uma classe base
`@Configuration`, ou um helper que retorna um `JobBuilder`/`StepBuilder`
parcialmente configurado), o que é, aliás, mais natural numa linguagem que já
tem herança e métodos exatamente para esse propósito.

## Trade-offs

- **O vocabulário XML e a API do `JobBuilder` expressam a mesma superfície de
  configuração, mas a forma em Java mantém o identificador e a classe a que
  ele se refere (um incrementer, um validator, um listener) numa única
  unidade compilada e segura para refatoração.** Um typo num atributo `ref`
  do XML só aparece na hora de subir o job; um typo numa chamada de método
  Java não compila.
- **`preventRestart()`/`incrementer()`/`validator()` vêm todos desligados por
  padrão quando omitidos**, batendo exatamente com os padrões XML do livro —
  nada na semântica mudou, só a superfície de configuração migrou de markup
  para chamadas de método.
- **Perder a herança de job via `parent`/`abstract` não é uma perda real** —
  era um workaround do XML para a falta de reuso em nível de linguagem; a
  configuração em Java não precisa de um equivalente porque métodos comuns e
  hierarquias de classe já fazem esse trabalho, geralmente de forma mais
  legível.
- **Book vs. today:** todo o vocabulário XML documentado neste capítulo
  (`<job>`, `<step>`, `<batch:validator>` e seus atributos) está depreciado
  desde o Spring Batch 6.0, com remoção planejada para a 7.0 — já observado
  em `spring-batch-chunk-processing`. Este conceito foca nos atributos
  específicos que o Capítulo 3 adiciona (restart, incrementer, validator) em
  vez de recobrir a própria depreciação do namespace.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", section 3.1, "The Spring Batch XML vocabulary", and section 3.2, "Configuring jobs and steps", p. 53-61 — doc
- [Spring Batch Reference — Configuring a Job (JobBuilder, preventRestart, incrementer, validator)](https://docs.spring.io/spring-batch/reference/job/configuring-job.html) — doc
- [Spring Batch API — JobParametersValidator / DefaultJobParametersValidator](https://docs.spring.io/spring-batch/docs/current/api/org/springframework/batch/core/job/DefaultJobParametersValidator.html) — doc
- [Spring Batch 6.0 Migration Guide — XML namespace deprecation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
