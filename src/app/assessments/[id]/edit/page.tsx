import AssessmentForm from "../../new/_components/assessment-form";

type EditAssessmentPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditAssessmentPage({ params }: EditAssessmentPageProps) {
  const { id } = await params;
  return <AssessmentForm mode="edit" assessmentId={id} />;
}
